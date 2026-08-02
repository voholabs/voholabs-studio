import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import { DiscordDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/discord.dto';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';

// https://discord.com/developers/docs/topics/permissions
// BigInt() rather than 1n literals: the TS target is below ES2020.
// https://discord.com/developers/docs/resources/channel#channel-object-channel-types
const DISCORD_CHANNEL_TYPES = {
  TEXT: 0,
  ANNOUNCEMENT: 5,
  FORUM: 15,
};

const DISCORD_THREAD_NAME_LIMIT = 100;

// Discord serves six numbered default avatars for accounts with no picture.
const DISCORD_DEFAULT_AVATARS = 6;

const NO_PERMISSIONS = BigInt(0);
const DISCORD_PERMISSIONS = {
  ADMINISTRATOR: BigInt(8), // 1 << 3
  VIEW_CHANNEL: BigInt(1024), // 1 << 10
  SEND_MESSAGES: BigInt(2048), // 1 << 11
  ATTACH_FILES: BigInt(32768), // 1 << 15
};

export class DiscordProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 5; // Discord has generous rate limits for webhook posting
  identifier = 'discord';
  name = 'Discord';
  isBetweenSteps = false;
  editor = 'markdown' as const;
  scopes = ['identify', 'guilds'];
  maxLength() {
    return 1980;
  }
  dto = DiscordDto;

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    const { access_token, expires_in, refresh_token } = await (
      await this.fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            process.env.DISCORD_CLIENT_ID +
              ':' +
              process.env.DISCORD_CLIENT_SECRET
          ).toString('base64')}`,
        },
      })
    ).json();

    const { application } = await (
      await this.fetch('https://discord.com/api/oauth2/@me', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      refreshToken: refresh_token,
      expiresIn: expires_in,
      accessToken: access_token,
      id: '',
      name: application.name,
      picture: '',
      username: '',
    };
  }
  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: `https://discord.com/oauth2/authorize?client_id=${
        process.env.DISCORD_CLIENT_ID
      }&permissions=377957124096&response_type=code&redirect_uri=${encodeURIComponent(
        `${process.env.FRONTEND_URL}/integrations/social/discord`
      )}&integration_type=0&scope=bot+identify+guilds&state=${state}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { access_token, expires_in, refresh_token, scope, guild } = await (
      await this.fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          code: params.code,
          grant_type: 'authorization_code',
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/discord`,
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            process.env.DISCORD_CLIENT_ID +
              ':' +
              process.env.DISCORD_CLIENT_SECRET
          ).toString('base64')}`,
        },
      })
    ).json();

    this.checkScopes(this.scopes, scope.split(' '));

    const { application } = await (
      await this.fetch('https://discord.com/api/oauth2/@me', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    // One connection is one server, and the same bot is installed in every
    // customer's server, so naming the channel after the app would show the
    // same name and avatar for all of them. Identify it by the server instead.
    const serverName = guild?.name || application.name;
    const serverIcon = this.serverIcon(guild);

    return {
      id: guild.id,
      name: serverName,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      picture: serverIcon,
      username: serverName,
    };
  }

  private _botUserId = '';
  private _channelNameCache = new Map<string, { at: number; name: string }>();
  private _roleContextCache = new Map<
    string,
    {
      at: number;
      value: {
        userId: string;
        memberRoles: string[];
        rolePermissions: Map<string, bigint>;
      };
    }
  >();

  /**
   * The server's own icon, or one of Discord's default avatars when it has
   * none. Deliberately never the bot's avatar: the same bot sits in every
   * customer's server, so using it would make every server without an icon
   * look identical — the very thing naming the channel after the server is
   * meant to avoid. Picking the default by server id keeps it stable, and
   * always returning something means a reconnect can correct a channel that
   * was saved with the wrong picture.
   */
  private serverIcon(guild: { id: string; icon?: string | null }) {
    if (guild?.icon) {
      return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`;
    }

    const digits = (guild?.id || '0').replace(/\D/g, '').slice(-3) || '0';
    return `https://cdn.discordapp.com/embed/avatars/${
      Number(digits) % DISCORD_DEFAULT_AVATARS
    }.png`;
  }

  private botHeaders() {
    return {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
    };
  }

  /** The bot's own user id. Fixed for the lifetime of the token. */
  private async botUserId() {
    if (!this._botUserId) {
      const me = await (
        await this.fetch('https://discord.com/api/users/@me', {
          headers: this.botHeaders(),
        })
      ).json();

      if (!me?.id) {
        throw new Error('Could not resolve the bot user');
      }

      this._botUserId = String(me.id);
    }

    return this._botUserId;
  }

  /**
   * The bot's own roles in a guild, plus the permission bits of every role.
   * Both are needed to work out what it may do in a given channel: Discord has
   * no "can I post here" endpoint, so the answer has to be computed.
   */
  private async guildRoleContext(guildId: string) {
    // Scheduling 20 posts at once validates 20 times; the roles behind them do
    // not change between those calls, so hold them briefly.
    const cached = this._roleContextCache.get(guildId);
    if (cached && Date.now() - cached.at < 60_000) {
      return cached.value;
    }

    // There is no `members/@me` route — Discord rejects "@me" as a snowflake
    // there — so the bot's own id has to be resolved first.
    const userId = await this.botUserId();

    const [member, roles] = await Promise.all([
      (
        await this.fetch(
          `https://discord.com/api/guilds/${guildId}/members/${userId}`,
          { headers: this.botHeaders() }
        )
      ).json(),
      (
        await this.fetch(`https://discord.com/api/guilds/${guildId}/roles`, {
          headers: this.botHeaders(),
        })
      ).json(),
    ]);

    // Refuse to guess. Reporting "no access" off a malformed response would
    // block posts that are perfectly fine, which is worse than not checking.
    if (!Array.isArray(member?.roles) || !Array.isArray(roles)) {
      throw new Error('Could not read the bot permissions for this guild');
    }

    const rolePermissions = new Map<string, bigint>(
      roles.map((r: any) => [String(r.id), BigInt(r.permissions || 0)])
    );

    const value = {
      userId,
      memberRoles: member.roles.map((r: any) => String(r)),
      rolePermissions,
    };
    this._roleContextCache.set(guildId, { at: Date.now(), value });

    return value;
  }

  /**
   * Effective permission bits for the bot in one channel, following Discord's
   * documented order: role permissions, then the @everyone overwrite, then the
   * role overwrites, then the member-specific overwrite.
   */
  private channelPermissions(
    guildId: string,
    channel: { permission_overwrites?: any[] },
    ctx: { userId: string; memberRoles: string[]; rolePermissions: Map<string, bigint> }
  ): bigint {
    let permissions = ctx.rolePermissions.get(guildId) || NO_PERMISSIONS; // @everyone
    for (const roleId of ctx.memberRoles) {
      permissions |= ctx.rolePermissions.get(roleId) || NO_PERMISSIONS;
    }

    // Administrator bypasses every channel overwrite.
    if (permissions & DISCORD_PERMISSIONS.ADMINISTRATOR) {
      return permissions;
    }

    const overwrites = channel.permission_overwrites || [];
    const apply = (overwrite: any) => {
      permissions &= ~BigInt(overwrite.deny || 0);
      permissions |= BigInt(overwrite.allow || 0);
    };

    // These endpoints are called unversioned, and the overwrite type is 0/1 on
    // v8+ but "role"/"member" on older versions. Accept both rather than assume
    // which version this deployment is talking to.
    const isRole = (o: any) => o.type === 0 || o.type === '0' || o.type === 'role';
    const isMember = (o: any) =>
      o.type === 1 || o.type === '1' || o.type === 'member';

    const everyone = overwrites.find((o: any) => String(o.id) === guildId);
    if (everyone) {
      apply(everyone);
    }

    // Role overwrites are accumulated before being applied, so that an allow on
    // one role beats a deny on another.
    let allow = NO_PERMISSIONS;
    let deny = NO_PERMISSIONS;
    for (const overwrite of overwrites) {
      if (isRole(overwrite) && ctx.memberRoles.includes(String(overwrite.id))) {
        deny |= BigInt(overwrite.deny || 0);
        allow |= BigInt(overwrite.allow || 0);
      }
    }
    permissions &= ~deny;
    permissions |= allow;

    const member = overwrites.find(
      (o: any) => isMember(o) && String(o.id) === ctx.userId
    );
    if (member) {
      apply(member);
    }

    return permissions;
  }

  /** Which of VIEW_CHANNEL / SEND_MESSAGES / ATTACH_FILES the bot is missing. */
  private missingPermissions(permissions: bigint, needsAttachments: boolean) {
    const missing: string[] = [];
    if (!(permissions & DISCORD_PERMISSIONS.VIEW_CHANNEL)) {
      missing.push('View Channel');
    }
    if (!(permissions & DISCORD_PERMISSIONS.SEND_MESSAGES)) {
      missing.push('Send Messages');
    }
    if (needsAttachments && !(permissions & DISCORD_PERMISSIONS.ATTACH_FILES)) {
      missing.push('Attach Files');
    }
    return missing;
  }

  @Tool({ description: 'Channels', dataSchema: [] })
  async channels(accessToken: string, params: any, id: string) {
    const list = await (
      await this.fetch(`https://discord.com/api/guilds/${id}/channels`, {
        headers: this.botHeaders(),
      })
    ).json();

    const postable = list.filter((p: any) =>
      Object.values(DISCORD_CHANNEL_TYPES).includes(Number(p.type))
    );

    // Discord lists every channel of the guild, including ones the bot cannot
    // post in, so say which is which instead of letting the choice fail later.
    // Best-effort: if the permission lookup fails, list the channels plainly.
    let ctx;
    try {
      ctx = await this.guildRoleContext(id);
    } catch (err) {
      return postable.map((p: any) => ({ id: String(p.id), name: p.name }));
    }

    return postable.map((p: any) => {
      const isForum = Number(p.type) === DISCORD_CHANNEL_TYPES.FORUM;
      const missing = this.missingPermissions(
        this.channelPermissions(id, p, ctx),
        false
      );

      return {
        id: String(p.id),
        name: missing.length ? `${p.name} (bot has no access)` : p.name,
        canPost: missing.length === 0,
        // Forum posts are threads, so they need a title. The UI shows a field
        // for it when this is set, and an agent reads it from the schema.
        isForum,
      };
    });
  }

  /**
   * Every forum post is a thread, and a thread must be named. An explicit
   * title wins; otherwise the first non-empty line of the post is used, capped
   * at Discord's 100 character limit. Returns '' when neither is available, so
   * the caller can refuse rather than invent a name.
   */
  private forumTitle(settings: DiscordDto, message: string) {
    const explicit = (settings?.title || '').trim();
    if (explicit) {
      return explicit.slice(0, DISCORD_THREAD_NAME_LIMIT);
    }

    const firstLine = (message || '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    return (firstLine || '').slice(0, DISCORD_THREAD_NAME_LIMIT);
  }

  private async getChannel(channelId: string) {
    return (
      await this.fetch(`https://discord.com/api/channels/${channelId}`, {
        headers: this.botHeaders(),
      })
    ).json();
  }

  /**
   * The channel a post goes to. Read on demand rather than saved with the
   * post, so renaming the channel in Discord is reflected everywhere, and a
   * post scheduled by an agent — which only ever passes a channel id — reads
   * the same as one scheduled from the dashboard.
   */
  async describeTarget(
    integration: Integration,
    settings: DiscordDto
  ): Promise<string | undefined> {
    const channelId = settings?.channel;

    if (!channelId) {
      return undefined;
    }

    const cached = this._channelNameCache.get(channelId);
    if (cached && Date.now() - cached.at < 300_000) {
      return cached.name;
    }

    try {
      const channel = await this.getChannel(channelId);
      if (!channel?.name) {
        return undefined;
      }

      const name = `#${channel.name}`;
      this._channelNameCache.set(channelId, { at: Date.now(), name });

      return name;
    } catch (err) {
      // Never let a Discord hiccup break a page that only wanted a label.
      return undefined;
    }
  }

  // Media is absolute on remote storage but relative on local storage, where
  // fetch() would reject the bare path.
  private mediaUrl(path: string) {
    return path.indexOf('http') === 0
      ? path
      : `${process.env.FRONTEND_URL}/${path.replace(/^\//, '')}`;
  }

  // A signed URL carries a query string that must not end up in the filename
  // Discord shows next to the attachment.
  private mediaFilename(path: string) {
    return path.split('?')[0].split('/').pop() || 'attachment';
  }

  // Images and videos both go up as plain multipart attachments; Discord picks
  // the player or the preview from the file type itself. Links need nothing
  // special — they travel in the message content and Discord unfurls them.
  private async buildMessageForm(
    post: PostDetails,
    // Present only for a forum, where the payload is a named thread wrapping
    // the same message body. Absent, the payload is exactly what it always was.
    thread?: { name: string }
  ) {
    const media = post.media || [];
    const form = new FormData();

    const message = {
      content: post.message.replace(/\[\[\[(@.*?)]]]/g, (match, p1) => {
        return `<${p1}>`;
      }),
      attachments: media.map((p, index) => ({
        id: index,
        description: p.alt || this.mediaFilename(p.path),
        filename: this.mediaFilename(p.path),
      })),
    };

    form.append(
      'payload_json',
      JSON.stringify(thread ? { name: thread.name, message } : message)
    );

    let index = 0;
    for (const item of media) {
      const loaded = await fetch(this.mediaUrl(item.path));

      form.append(
        `files[${index}]`,
        await loaded.blob(),
        this.mediaFilename(item.path)
      );
      index++;
    }

    return form;
  }

  /**
   * A channel the bot cannot post in is the classic way a Discord post dies:
   * scheduling succeeds, and hours later the publish fails with "Bot doesn't
   * have access to this channel" and nobody is watching. Check it up front.
   *
   * Best-effort by design: a Discord outage must not block scheduling, so any
   * failure to determine the permissions passes validation.
   */
  async validateSettings(
    integration: Integration,
    settings: DiscordDto,
    post: { hasMedia: boolean; content: string }
  ): Promise<string | true> {
    const channelId = settings?.channel;

    if (!channelId) {
      return true; // the DTO already requires it
    }

    try {
      const [channel, ctx] = await Promise.all([
        this.getChannel(channelId),
        this.guildRoleContext(integration.internalId),
      ]);

      // An agent or an API caller can pass any channel id, so a forum is
      // detected here and not only in the picker. A forum post is a thread and
      // a thread must be named, so refuse now rather than invent a title at
      // publish time.
      if (
        Number(channel?.type) === DISCORD_CHANNEL_TYPES.FORUM &&
        !this.forumTitle(settings, post.content)
      ) {
        return `#${
          channel?.name || channelId
        } is a forum channel, so the post needs a title. Add one in the channel settings, or start the post with a line of text to use as the title.`;
      }

      const missing = this.missingPermissions(
        this.channelPermissions(integration.internalId, channel, ctx),
        post.hasMedia
      );

      if (missing.length) {
        return `The bot cannot post in #${
          channel?.name || channelId
        } — it is missing: ${missing.join(
          ', '
        )}. Give the bot access to that channel in Discord, or pick another channel.`;
      }

      return true;
    } catch (err) {
      // Being unable to read the channel at all is itself the failure we are
      // trying to prevent, and handleErrors has already turned those Discord
      // codes into these messages. Anything else counts as a transient problem
      // and is allowed through rather than blocking a valid post.
      const message = (err as any)?.message || '';
      const deniesAccess = [
        "Bot doesn't have access to this channel", // 50001
        'Bot lacks permission to send messages in this channel', // 50013
        'Channel no longer exists', // 10003
      ].some((known) => message.includes(known));

      if (deniesAccess) {
        return `${message}. Give the bot access to that channel in Discord, or pick another channel.`;
      }

      return true;
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const channel = firstPost.settings.channel;

    const target = await this.getChannel(channel);

    if (Number(target?.type) === DISCORD_CHANNEL_TYPES.FORUM) {
      return [await this.postToForum(id, channel, firstPost)];
    }

    const form = await this.buildMessageForm(firstPost);

    const data = await (
      await this.fetch(`https://discord.com/api/channels/${channel}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
        },
        body: form,
      })
    ).json();

    return [
      {
        id: firstPost.id,
        releaseURL: `https://discord.com/channels/${id}/${channel}/${data.id}`,
        postId: data.id,
        status: 'success',
      },
    ];
  }

  /**
   * A forum channel holds threads, not messages, so the post is created as a
   * thread whose opening message carries the content and the media. Discord
   * gives the thread the same id as that opening message, which is what makes
   * the existing delete and comment paths work unchanged.
   */
  private async postToForum(
    guildId: string,
    channel: string,
    post: PostDetails
  ): Promise<PostResponse> {
    const name = this.forumTitle(post.settings, post.message);

    if (!name) {
      // validateSettings normally catches this while scheduling; failing loudly
      // beats opening a thread under a made-up name.
      throw new Error(
        'This forum post has no title and no text to take one from.'
      );
    }

    const form = await this.buildMessageForm(post, { name });

    const data = await (
      await this.fetch(`https://discord.com/api/channels/${channel}/threads`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
        },
        body: form,
      })
    ).json();

    // The response is the thread; its opening message is nested under `message`
    // on versions that return it, and shares the thread id either way.
    const messageId = String(data?.message?.id || data?.id);

    return {
      id: post.id,
      releaseURL: `https://discord.com/channels/${guildId}/${data.id}/${messageId}`,
      postId: messageId,
      status: 'success',
    };
  }

  async deletePost(
    id: string,
    accessToken: string,
    postId: string,
    post: { settings: DiscordDto; releaseURL?: string | null }
  ): Promise<boolean> {
    // Comments are posted into a thread, so their channel is the thread id and
    // not the one in settings. The release URL is the only record of it:
    // https://discord.com/channels/<guild>/<channel>/<message>
    const fromUrl = post?.releaseURL?.split('/channels/')[1]?.split('/')?.[1];
    const channel = fromUrl || post?.settings?.channel;

    if (!channel || !postId) {
      return false;
    }

    // A forum post is a thread whose id is also its opening message id, and
    // that opening message cannot be deleted on its own — Discord answers 404
    // Unknown Message. Deleting the thread is what removes the post.
    const isThreadStarter = String(channel) === String(postId);
    const url = isThreadStarter
      ? `https://discord.com/api/channels/${channel}`
      : `https://discord.com/api/channels/${channel}/messages/${postId}`;

    // Deliberately not this.fetch: a successful message delete answers 204,
    // and the shared helper only lets 200/201 through.
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
      },
    });

    if (response.ok) {
      return true;
    }

    // Only a message that is genuinely gone counts as already-deleted. Treating
    // every 404 as success is what hid a wrong endpoint here before.
    if (response.status === 404 && !isThreadStarter) {
      return true;
    }

    const body = await response.text().catch(() => '');
    throw new Error(
      this.handleErrors(body)?.value ||
        `Discord refused to delete the post (${response.status})`
    );
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const channel = commentPost.settings.channel;

    // Comments go into a thread hanging off the original message. A forum post
    // is already a thread, so only a text or announcement channel needs one
    // created.
    const target = await this.getChannel(channel);
    const isForum = Number(target?.type) === DISCORD_CHANNEL_TYPES.FORUM;

    // Discord gives a message-started thread the id of that message, and a
    // forum post the id of its opening message, so the thread to reply in is
    // postId either way. Previously this was only tracked for the first
    // comment, which sent every later one to the main channel instead.
    let threadChannel = postId;

    if (!lastCommentId && !isForum) {
      const { id: threadId } = await (
        await this.fetch(
          `https://discord.com/api/channels/${channel}/messages/${postId}/threads`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: 'Thread',
              auto_archive_duration: 1440,
            }),
          }
        )
      ).json();
      threadChannel = threadId || postId;
    }

    const form = await this.buildMessageForm(commentPost);

    const data = await (
      await this.fetch(
        `https://discord.com/api/channels/${threadChannel}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
          },
          body: form,
        }
      )
    ).json();

    return [
      {
        id: commentPost.id,
        releaseURL: `https://discord.com/channels/${id}/${threadChannel}/${data.id}`,
        postId: data.id,
        status: 'success',
      },
    ];
  }

  async changeNickname(id: string, accessToken: string, name: string) {
    await (
      await this.fetch(`https://discord.com/api/guilds/${id}/members/@me`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nick: name,
        }),
      })
    ).json();

    return {
      name,
    };
  }

  override async mention(
    token: string,
    data: { query: string },
    id: string,
    integration: Integration
  ) {
    const allRoles = await (
      await this.fetch(`https://discord.com/api/guilds/${id}/roles`, {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
          'Content-Type': 'application/json',
        },
      })
    ).json();

    const matching = allRoles
      .filter((role: any) =>
        role.name.toLowerCase().includes(data.query.toLowerCase())
      )
      .filter((f: any) => f.name !== '@everyone' && f.name !== '@here');

    const list = await (
      await this.fetch(
        `https://discord.com/api/guilds/${id}/members/search?query=${data.query}`,
        {
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
            'Content-Type': 'application/json',
          },
        }
      )
    ).json();

    return [
      ...[
        {
          id: String('here'),
          label: 'here',
          image: '',
          doNotCache: true,
        },
        {
          id: String('everyone'),
          label: 'everyone',
          image: '',
          doNotCache: true,
        },
      ].filter((role: any) => {
        return role.label.toLowerCase().includes(data.query.toLowerCase());
      }),
      ...matching.map((p: any) => ({
        id: String('&' + p.id),
        label: p.name.split('@')[1],
        image: '',
        doNotCache: true,
      })),
      ...list.map((p: any) => ({
        id: String(p.user.id),
        label: p.user.global_name || p.user.username,
        image: `https://cdn.discordapp.com/avatars/${p.user.id}/${p.user.avatar}.png`,
      })),
    ];
  }

  mentionFormat(idOrHandle: string, name: string) {
    if (name === '@here' || name === '@everyone') {
      return name;
    }
    return `[[[@${idOrHandle.replace('@', '')}]]]`;
  }

  override handleErrors(
    body: string
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    if (body.includes('50001')) {
      return {
        type: 'bad-body',
        value: "Bot doesn't have access to this channel",
      };
    }

    if (body.includes('50013')) {
      return {
        type: 'bad-body',
        value: 'Bot lacks permission to send messages in this channel',
      };
    }

    if (body.includes('10003')) {
      return {
        type: 'bad-body',
        value: 'Channel no longer exists',
      };
    }

    if (body.includes('40005')) {
      return {
        type: 'bad-body',
        value: "Attachment exceeds Discord's size limit",
      };
    }

    if (body.includes('20028')) {
      return {
        type: 'retry',
        value: 'Rate limited by Discord',
      };
    }

    return undefined;
  }
}
