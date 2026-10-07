import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { Request, Response } from 'express';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { AgentGraphInsertService } from '@gitroom/nestjs-libraries/agent/agent.graph.insert.service';
import { timingSafeEqual } from 'crypto';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';
import { OnlyURL } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import {
  safeFetch,
  SafeFetchError,
} from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';

const pump = promisify(pipeline);

@ApiTags('Public')
@Controller('/public')
export class PublicController {
  constructor(
    private _trackService: TrackService,
    private _agentGraphInsertService: AgentGraphInsertService,
    private _postsService: PostsService
  ) {}
  @Post('/agent')
  async createAgent(@Body() body: { text: string; apiKey: string }) {
    if (!process.env.AGENT_API_KEY || typeof body?.apiKey !== 'string') {
      return;
    }
    const given = Buffer.from(body.apiKey);
    const expected = Buffer.from(process.env.AGENT_API_KEY);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return;
    }
    return this._agentGraphInsertService.newPost(body.text);
  }

  @Get(`/posts/:id`)
  async getPreview(@Param('id') id: string) {
    return Promise.all(
      (await this._postsService.getPostsRecursively(id, true)).map(
        async ({ childrenPost, ...p }) => ({
          ...p,
          // The account alone does not say where the post lands: a Discord
          // connection is a whole server, and this is the channel within it.
          target: await this._postsService.describeTarget(p.integration, p.settings),
          ...(p.integration
            ? {
                integration: {
                  id: p.integration.id,
                  name: p.integration.name,
                  picture: p.integration.picture,
                  providerIdentifier: p.integration.providerIdentifier,
                  profile: p.integration.profile,
                },
              }
            : {}),
        })
      )
    );
  }

  @Get(`/posts/:id/comments`)
  async getComments(@Param('id') postId: string) {
    return { comments: await this._postsService.getComments(postId) };
  }

  @Post('/t')
  async trackEvent(
    @Res() res: Response,
    @Req() req: Request,
    @RealIP() ip: string,
    @UserAgent() userAgent: string,
    @Body()
    body: { fbclid?: string; tt: TrackEnum; additional: Record<string, any> }
  ) {
    const uniqueId = req?.cookies?.track || makeId(10);
    const fbclid = req?.cookies?.fbclid || body.fbclid;
    await this._trackService.track(
      uniqueId,
      ip,
      userAgent,
      body.tt,
      body.additional,
      fbclid
    );
    if (!req.cookies.track) {
      res.cookie('track', uniqueId, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
            }
          : {}),
        sameSite: 'none',
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
    }

    if (body.fbclid && !req.cookies.fbclid) {
      res.cookie('fbclid', body.fbclid, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
            }
          : {}),
        sameSite: 'none',
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
    }

    res.status(200).json({
      track: uniqueId,
    });
  }

  @Get('/stream')
  async streamFile(
    @Query() query: OnlyURL,
    @Res() res: Response,
    @Req() req: Request
  ) {
    const { url } = query;

    // Only https URLs whose path (not query string) names an .mp4 file.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).send('Invalid video URL');
    }
    if (
      parsed.protocol !== 'https:' ||
      !parsed.pathname.toLowerCase().endsWith('.mp4')
    ) {
      return res.status(400).send('Invalid video URL');
    }

    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on('aborted', onClose);
    res.on('close', onClose);

    // safeFetch re-validates every redirect hop and connects through the
    // SSRF-safe dispatcher. This route needs no sign-in, so the guard stays
    // on even where DISABLE_SSRF_PROTECTION is set.
    let r: globalThis.Response;
    try {
      r = await safeFetch(
        parsed.toString(),
        { signal: ac.signal },
        {
          timeoutMs: 60_000,
          // A long video keeps streaming past the timeout; the client
          // closing the connection aborts it instead.
          timeoutCoversBody: false,
          maxRedirects: 5,
          allowedContentTypes: [
            'video/',
            'application/octet-stream',
            'binary/octet-stream',
          ],
          ignoreOptOut: true,
        }
      );
    } catch (err) {
      if (err instanceof SafeFetchError) {
        return res.status(err.status).send(err.message);
      }
      if (ac.signal.aborted) return;
      return res.status(502).send('Upstream error');
    }

    if (!r.ok && r.status !== 206) {
      await r.body?.cancel().catch(() => undefined);
      return res.status(r.status >= 400 ? r.status : 502).send('Upstream error');
    }

    // Never pass the upstream type through: this response is served from
    // the app's own origin.
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');

    const contentRange = r.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const len = r.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    const acceptRanges = r.headers.get('accept-ranges') ?? 'bytes';
    res.setHeader('Accept-Ranges', acceptRanges);

    if (r.status === 206) res.status(206); // Partial Content for range responses

    if (!r.body) {
      return res.end();
    }

    try {
      await pump(Readable.fromWeb(r.body as any), res);
    } catch (err) {}
  }
}
