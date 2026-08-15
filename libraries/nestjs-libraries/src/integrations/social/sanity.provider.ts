import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { SanityDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/sanity.dto';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

// Pinned Content Lake API version. v2025-02-19 is the version the Actions API
// reference documents as its default and is the first to carry the current
// Content Releases / perspective behaviour, so every request below is explicit
// about `perspective=raw` rather than relying on a default that has changed
// between versions.
const SANITY_API_VERSION = 'v2025-02-19';

// Sanity's own system documents (releases live under `_.`), the asset documents
// (`sanity.imageAsset`, `sanity.fileAsset`) and release versions are never
// "blog posts", so they are filtered out of every listing. Everything else is
// listed whatever its `_type` is - a Sanity schema can call a post `post`,
// `article`, `blogPost` or anything else, and asking the user to configure that
// up front is a setup step that buys nothing.
const LIST_FILTER = `!(_id in path("_.**")) && !(_id in path("versions.**")) && !(_type match "sanity.*") && !(_type match "system.*")`;

// Fields a Sanity schema commonly uses for the human-readable name of a
// document. Coalesced so a listing shows something meaningful without us
// knowing anything about the user's schema.
const TITLE_PROJECTION = `coalesce(title, name, heading, headline, label, subject)`;

const DRAFT_PREFIX = 'drafts.';

// What a schema tends to call the date it puts on the things it publishes.
const PUBLISH_DATE_FIELDS = [
  'publishedAt',
  'publishDate',
  'publishedTime',
  'datePublished',
  'published_at',
  'date',
];

// The Studio address rarely changes, and resolving it costs two API calls, so
// it is remembered per project rather than looked up on every listing.
const STUDIO_URL_CACHE = new Map<string, { url: string; expires: number }>();
const STUDIO_URL_TTL = 10 * 60 * 1000;

// Where the published articles actually live on the web. Worked out once by
// asking the site, then remembered - it cannot change often enough to be worth
// probing on every listing.
const SITE_PREFIX_CACHE = new Map<
  string,
  { prefix: string; expires: number }
>();

// Which fields a document type normally carries, worked out from the documents
// that already exist. Cached because it costs a query and changes rarely.
const EXPECTED_FIELDS_CACHE = new Map<
  string,
  { fields: string[]; expires: number }
>();

// A field this common on other documents of the same type is part of the type,
// so a document without it is missing something rather than simply differing.
const EXPECTED_FIELD_THRESHOLD = 0.7;

// Paths a blog sits under, in the order they are worth trying.
const BLOG_PATH_CANDIDATES = [
  '/blog/',
  '/posts/',
  '/articles/',
  '/insights/',
  '/news/',
  '/',
];

type SanityCredentials = {
  projectId: string;
  dataset: string;
  token: string;
  studioUrl?: string;
};

type SanityRow = {
  _id: string;
  _type: string;
  _rev?: string;
  _createdAt?: string;
  _updatedAt?: string;
  title?: string | null;
  slug?: string | null;
  image?: string;
};

export type SanityDocumentSummary = {
  id: string;
  type: string;
  title: string;
  slug: string;
  status: 'draft' | 'published';
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  image: string;
  liveUrl: string;
  editUrl: string;
};

@Rules(
  `Sanity is a headless CMS channel. Voholabs Studio never holds the article itself - the content lives in Sanity and is authored there (through the Sanity Studio or the Sanity MCP), never through Voholabs Studio. Scheduling a Sanity post means: pick an existing document and give it a publish time. Pass the document's published id (without the "drafts." prefix) as "documentId" in the settings; use the sanity "documents" tool to list what exists. At the scheduled time Voholabs Studio publishes that document's draft in Sanity. Do not try to write a message body for this channel - it is ignored.`
)
export class SanityProvider extends SocialAbstract implements SocialProvider {
  identifier = 'sanity';
  name = 'Sanity';
  isBetweenSteps = false;
  // The article is written in Sanity, so Voholabs Studio shows no editor at all for this
  // channel - only the document picker in the settings component.
  editor = 'none' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 5;
  dto = SanityDto;

  maxLength() {
    return 100000;
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  override handleErrors(
    body: string,
    status: number
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    if (status === 401 || body.indexOf('Unauthorized') > -1) {
      return {
        type: 'bad-body',
        value:
          'Sanity rejected the API token. Re-connect the channel with a valid token.',
      };
    }

    if (status === 403 || body.indexOf('Insufficient permissions') > -1) {
      return {
        type: 'bad-body',
        value:
          'The Sanity token does not have permission to publish this document. It needs a role with write access, such as Editor.',
      };
    }

    return undefined;
  }

  // Sanity has no OAuth flow a third party can use - its own docs point
  // integrations at a hand-made "robot token" - so connecting is inherently a
  // few steps in another tab. The least we can do is spell them out and link
  // straight to the right page once the project id is known.
  customFieldsSetup = {
    title: 'Connect your Sanity project',
    steps: [
      'Open [sanity.io/manage](https://www.sanity.io/manage) and click the project your blog comes from.',
      'Copy the Project ID from that page - it is the short code at the end of the address - and paste it below.',
      'Dataset is usually "production".',
      'In the same project open API → Tokens → Add API token, give it the **Editor** role, and paste it below. Sanity shows it once. Viewer connects but then fails when a post is due.',
    ],
    links: [
      {
        label: 'Open Sanity Manage',
        url: 'https://www.sanity.io/manage',
      },
      {
        label: 'Create the token for this project',
        url: 'https://www.sanity.io/manage/project/{projectId}/api#tokens',
      },
    ],
  };

  async customFields() {
    return [
      {
        key: 'projectId',
        label: 'Project ID',
        validation: `/^[a-z0-9-]{3,}$/`,
        type: 'text' as const,
        hint: 'The short id on your project page, e.g. abc12xyz',
      },
      {
        key: 'dataset',
        label: 'Dataset',
        defaultValue: 'production',
        validation: `/^[a-zA-Z0-9._-]{1,}$/`,
        type: 'text' as const,
      },
      {
        key: 'token',
        label: 'API token',
        validation: `/^.{10,}$/`,
        type: 'password' as const,
        hint: 'Sanity project settings → API → Tokens. Needs Editor access to publish.',
      },
    ];
  }

  /**
   * The project id is the last segment of the sanity.io/manage URL for the
   * project, so the URL the user already has open is accepted as-is rather than
   * making them pick the id out of it. A bare id passes through untouched.
   */
  private normaliseProjectId(value: string) {
    const trimmed = (value || '')
      .trim()
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');

    return trimmed.includes('/') ? trimmed.split('/').pop() || '' : trimmed;
  }

  /** The project's human name, e.g. "Voholabs" rather than "pu3amsix". */
  private async resolveProjectName(projectId: string, token: string) {
    try {
      const project = await fetch(
        `https://api.sanity.io/${SANITY_API_VERSION}/projects/${encodeURIComponent(
          projectId
        )}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then((r) => (r.ok ? r.json() : null));

      return String(project?.displayName || '').trim();
    } catch (err) {
      console.log('Could not read the Sanity project name', err);
      return '';
    }
  }

  /**
   * Where this project's Studio is deployed. Sanity records it on the project
   * as `studioHost` when `sanity deploy` runs, so it is looked up rather than
   * asked for - the address is not derivable from the project id by hand (the
   * hostname is chosen at deploy time), but the API knows it.
   *
   * Best-effort: a project with no deployed Studio, or a token that cannot read
   * project metadata, simply means no "Edit in Sanity" links. That must never
   * stop the channel connecting.
   */
  private async resolveStudioUrl(projectId: string, token: string) {
    const cached = STUDIO_URL_CACHE.get(projectId);
    if (cached && cached.expires > Date.now()) {
      return cached.url;
    }

    const url = await this.lookupStudioUrl(projectId, token);

    STUDIO_URL_CACHE.set(projectId, {
      url,
      expires: Date.now() + STUDIO_URL_TTL,
    });

    return url;
  }

  private async lookupStudioUrl(projectId: string, token: string) {
    const headers = { Authorization: `Bearer ${token}` };
    const base = `https://api.sanity.io/${SANITY_API_VERSION}`;

    try {
      const project = await fetch(
        `${base}/projects/${encodeURIComponent(projectId)}`,
        { headers }
      ).then((r) => (r.ok ? r.json() : null));

      // A Studio deployed with `sanity deploy` records its hostname on the
      // project, and an externally registered one records its full URL.
      const studioHost = project?.studioHost;
      if (studioHost) {
        const url = String(studioHost).startsWith('http')
          ? String(studioHost)
          : `https://${studioHost}.sanity.studio`;

        return url.replace(/\/+$/, '');
      }

      // Otherwise the Studio may live in Sanity's own dashboard, which the
      // project record says nothing about - it is an "application" instead.
      const applications = await fetch(
        `${base}/user-applications?projectId=${encodeURIComponent(projectId)}`,
        { headers }
      ).then((r) => (r.ok ? r.json() : null));

      const studio = (Array.isArray(applications) ? applications : []).find(
        (app: any) => app?.type === 'studio'
      );

      if (!studio) {
        return '';
      }

      // Dashboard-hosted Studios are addressed by organization and application,
      // with the workspace as the last segment - the same shape the dashboard
      // itself uses.
      const organizationId = studio.organizationId || project?.organizationId;
      const workspace =
        studio?.activeDeployment?.manifest?.workspaces?.[0]?.name || 'default';

      if (studio.urlType === 'internal' && organizationId && studio.id) {
        return `https://www.sanity.io/@${organizationId}/studio/${studio.id}/${workspace}`;
      }

      if (studio.appHost) {
        return String(studio.appHost).startsWith('http')
          ? String(studio.appHost).replace(/\/+$/, '')
          : `https://${studio.appHost}.sanity.studio`;
      }

      return '';
    } catch (err) {
      console.log('Could not resolve the Sanity studio address', err);
      return '';
    }
  }

  /**
   * The credentials, with the Studio address filled in when it was not known at
   * connect time. Channels connected before the Studio existed - or before we
   * knew how to find dashboard-hosted ones - would otherwise never get Edit
   * links without being re-connected by hand.
   */
  private async withStudioUrl(credentials: SanityCredentials) {
    if (credentials.studioUrl) {
      return credentials;
    }

    return {
      ...credentials,
      studioUrl: await this.resolveStudioUrl(
        credentials.projectId,
        credentials.token
      ),
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(
      Buffer.from(params.code, 'base64').toString()
    ) as SanityCredentials;

    const projectId = this.normaliseProjectId(body.projectId);
    const dataset = (body.dataset || '').trim();

    let response: Response;
    try {
      // A cheap authenticated read: if the token, project and dataset all line
      // up this returns a number, and anything else tells us which of them is
      // wrong before the channel is ever saved.
      response = await fetch(
        `https://${projectId}.api.sanity.io/${SANITY_API_VERSION}/data/query/${encodeURIComponent(
          dataset
        )}?query=${encodeURIComponent('count(*)')}`,
        {
          headers: {
            Authorization: `Bearer ${body.token}`,
          },
        }
      );
    } catch (err) {
      console.log(err);
      return 'Could not reach Sanity. Check the Project ID and that the machine has network access.';
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.log(
        `Sanity auth failed for ${projectId}/${dataset} (HTTP ${response.status})`,
        errorBody.slice(0, 500)
      );

      if (response.status === 401 || response.status === 403) {
        return 'Sanity rejected the token. Check that it is valid and has at least Viewer access to this dataset.';
      }

      if (response.status === 404) {
        // The commonest cause is a Project ID that is not one: a path segment
        // off the end of a pasted URL, for instance.
        return `Sanity has no project "${projectId}" with a dataset called "${dataset}". The Project ID is the short code on your project page, e.g. abc12xyz - not part of a URL.`;
      }

      return `Sanity returned an unexpected error (HTTP ${response.status}).`;
    }

    const projectName = await this.resolveProjectName(projectId, body.token);

    // Normalise now so every later request can trust the shape.
    const accessToken = Buffer.from(
      JSON.stringify({
        projectId,
        dataset,
        token: body.token,
        // What the user gave us wins - they know where their Studio is. The
        // lookup is the fallback for Studios deployed through Sanity.
        studioUrl:
          (body.studioUrl || '').trim().replace(/\/+$/, '') ||
          (await this.resolveStudioUrl(projectId, body.token)),
      })
    ).toString('base64');

    return {
      refreshToken: '',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      accessToken,
      id: `${projectId}_${dataset}`,
      // The project's own name reads far better in the channel rail than its
      // id. Falls back to the id if the token cannot read project metadata.
      name: projectName
        ? `${projectName} (${dataset})`
        : `${projectId} (${dataset})`,
      // Without this every surface shows the grey placeholder circle.
      picture: '/icons/platforms/sanity.png',
      username: projectId,
    };
  }

  private decode(token: string): SanityCredentials {
    return JSON.parse(
      Buffer.from(token, 'base64').toString()
    ) as SanityCredentials;
  }

  private baseUrl(credentials: SanityCredentials) {
    return `https://${credentials.projectId}.api.sanity.io/${SANITY_API_VERSION}`;
  }

  private editUrl(
    credentials: SanityCredentials,
    documentId: string,
    type: string
  ) {
    if (!credentials.studioUrl) {
      // No Studio is deployed for this project, so there is no document editor
      // to open. The project's management page is the closest real destination
      // - better than a dead button.
      return `https://www.sanity.io/manage/project/${credentials.projectId}`;
    }

    // Sanity Studio's intent link - opens the document straight in the editor
    // whatever the studio's own routing looks like.
    return `${credentials.studioUrl}/intent/edit/id=${encodeURIComponent(
      documentId
    )};type=${encodeURIComponent(type)}`;
  }

  private queryUrl(
    credentials: SanityCredentials,
    query: string,
    params: Record<string, any> = {}
  ) {
    const url = new URL(
      `${this.baseUrl(credentials)}/data/query/${encodeURIComponent(
        credentials.dataset
      )}`
    );
    url.searchParams.set('query', query);
    // `raw` returns drafts and published documents side by side, which is
    // exactly the view we need: the other perspectives hide one or the other.
    url.searchParams.set('perspective', 'raw');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(`$${key}`, JSON.stringify(value));
    }

    return url.toString();
  }

  /**
   * GROQ read used by the custom provider functions below. Those are invoked
   * from the `/integrations/function` HTTP endpoint, which is not a Temporal
   * activity, so they use a plain `fetch` rather than `this.fetch` - the same
   * split WordPress makes.
   */
  private async query<T = any>(
    credentials: SanityCredentials,
    query: string,
    params: Record<string, any> = {}
  ): Promise<T> {
    const response = await fetch(this.queryUrl(credentials, query, params), {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Sanity query failed (HTTP ${response.status}): ${body.slice(0, 200)}`
      );
    }

    const { result } = await response.json();
    return result as T;
  }

  /** The same read, from inside a Temporal activity. */
  private async queryInActivity<T = any>(
    credentials: SanityCredentials,
    query: string,
    params: Record<string, any> = {}
  ): Promise<T> {
    const response = await this.fetch(
      this.queryUrl(credentials, query, params),
      {
        headers: {
          Authorization: `Bearer ${credentials.token}`,
        },
      }
    );

    const { result } = await response.json();
    return result as T;
  }

  /**
   * Dispatch Sanity document actions. The endpoint answers 200 even when an
   * individual action failed, so the per-action results are checked too.
   */
  private async dispatchActions(
    credentials: SanityCredentials,
    actions: any[],
    useActivityFetch: boolean
  ) {
    const url = `${this.baseUrl(credentials)}/data/actions/${encodeURIComponent(
      credentials.dataset
    )}`;
    const init: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ actions }),
    };

    const response = useActivityFetch
      ? await this.fetch(url, init)
      : await fetch(url, init);

    if (!useActivityFetch && !response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Sanity action failed (HTTP ${response.status}): ${body.slice(0, 200)}`
      );
    }

    const json = await response.json();
    const failed = (json?.results || []).find(
      (r: any) => r?.status === 'error'
    );

    if (failed) {
      throw new Error(
        failed?.error?.message || 'Sanity rejected the document action'
      );
    }

    return json;
  }

  private async mutate(
    credentials: SanityCredentials,
    mutations: any[],
    useActivityFetch: boolean
  ) {
    const url = `${this.baseUrl(credentials)}/data/mutate/${encodeURIComponent(
      credentials.dataset
    )}`;
    const init: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mutations }),
    };

    const response = useActivityFetch
      ? await this.fetch(url, init)
      : await fetch(url, init);

    if (!useActivityFetch && !response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Sanity mutation failed (HTTP ${response.status}): ${body.slice(0, 200)}`
      );
    }

    return response.json();
  }

  /**
   * The first image in a document, as a CDN URL. Sanity stores images as a
   * reference like `image-<asset>-<width>x<height>-<ext>`, which maps onto the
   * CDN path directly - so a thumbnail costs no extra request and works
   * whatever the schema calls the field.
   */
  private extractImage(
    credentials: SanityCredentials,
    value: any,
    depth = 0
  ): string {
    if (!value || typeof value !== 'object' || depth > 6) {
      return '';
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.extractImage(credentials, item, depth + 1);
        if (found) return found;
      }
      return '';
    }

    const ref = value?.asset?._ref;
    if (typeof ref === 'string' && ref.startsWith('image-')) {
      const [, asset, dimensions, extension] = ref.split('-');
      if (asset && dimensions && extension) {
        return `https://cdn.sanity.io/images/${credentials.projectId}/${credentials.dataset}/${asset}-${dimensions}.${extension}`;
      }
    }

    for (const child of Object.values(value)) {
      const found = this.extractImage(credentials, child, depth + 1);
      if (found) return found;
    }

    return '';
  }

  /**
   * Where a published article can be read on the web.
   *
   * The site's own address is in its settings document, but the path a blog
   * sits under is a choice the site made, so it is discovered by asking the
   * site about a post that is known to be live rather than assuming `/blog/`.
   * Returns '' when the site cannot be reached or nothing matches, in which
   * case the reader is sent to Sanity instead.
   */
  private async resolveSitePrefix(
    credentials: SanityCredentials,
    sampleSlug?: string
  ) {
    const cached = SITE_PREFIX_CACHE.get(credentials.projectId);
    if (cached && cached.expires > Date.now()) {
      return cached.prefix;
    }

    // The slug has to come from a published *article*. Picking any document
    // with a slug lands on an author or a category, whose slug has no page of
    // its own - the probe then 404s everywhere and concludes, wrongly, that the
    // blog cannot be found.
    if (!sampleSlug) {
      return cached?.prefix || '';
    }

    let prefix = '';

    try {
      const settings =
        (await this.query<any[]>(
          credentials,
          `*[defined(siteUrl)][0...1]{siteUrl}`
        )) || [];

      const siteUrl = String(settings?.[0]?.siteUrl || '')
        .trim()
        .replace(/\/+$/, '');

      // Resolved once, outside the ts-ignore below: putting the call on the
      // ignored line hides a missing import as well as the undici typing.
      const dispatcher = getSsrfSafeDispatcher();

      if (siteUrl) {
        for (const candidate of BLOG_PATH_CANDIDATES) {
          const target = `${siteUrl}${candidate}${sampleSlug}`;

          try {
            // GET rather than HEAD, with a real user agent: CDNs in front of
            // marketing sites routinely reject one or the other, and a rejected
            // probe is indistinguishable from a wrong path.
            const response = await fetch(target, {
              method: 'GET',
              redirect: 'follow',
              headers: {
                'user-agent':
                  'Mozilla/5.0 (compatible; VoholabsStudio/1.0; +https://voholabs.com)',
                accept: 'text/html',
              },
              // @ts-ignore - undici-only option; blocks SSRF to internal IPs
              dispatcher,
            });

            if (response.ok) {
              prefix = `${siteUrl}${candidate}`;
              break;
            }
          } catch (err: any) {
            console.log(
              `[sanity] could not reach ${target}: ${err?.message || err}`
            );
          }
        }
      } else {
        console.log('[sanity] no siteUrl found in the dataset');
      }
    } catch (err) {
      console.log('Could not work out where the blog lives', err);
    }

    // A failure is worth retrying sooner than a success is worth re-checking -
    // the site may simply have been down.
    SITE_PREFIX_CACHE.set(credentials.projectId, {
      prefix,
      expires: Date.now() + (prefix ? STUDIO_URL_TTL : 60 * 1000),
    });

    return prefix;
  }

  /** Is there actually something in this field? */
  private hasValue(value: any): boolean {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') {
      const keys = Object.keys(value).filter((k) => !k.startsWith('_'));
      return keys.some((k) => this.hasValue(value[k]));
    }
    return true;
  }

  /**
   * The fields a document of this type is expected to carry, learned from the
   * documents that already exist rather than from a fixed list. A schema can
   * call its metadata anything - seo, meta, openGraph - so the only reliable
   * definition of "missing metadata" is: the other posts have it and this one
   * does not. Nothing is invented, and nothing is demanded that this blog does
   * not otherwise use.
   */
  private async expectedFields(credentials: SanityCredentials, type: string) {
    const key = `${credentials.projectId}:${type}`;
    const cached = EXPECTED_FIELDS_CACHE.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.fields;
    }

    let fields: string[] = [];

    try {
      const others = await this.query<any[]>(
        credentials,
        `*[_type == $type && !(_id in path("drafts.**"))] | order(_updatedAt desc) [0...25]`,
        { type }
      );

      const sample = others || [];

      if (sample.length >= 3) {
        const counts = new Map<string, number>();

        for (const document of sample) {
          for (const [field, value] of Object.entries(document)) {
            if (field.startsWith('_')) continue;
            if (!this.hasValue(value)) continue;
            counts.set(field, (counts.get(field) || 0) + 1);
          }
        }

        fields = [...counts.entries()]
          .filter(
            ([, count]) => count / sample.length >= EXPECTED_FIELD_THRESHOLD
          )
          .map(([field]) => field);
      }
    } catch (err) {
      console.log('Could not work out the expected fields', err);
    }

    EXPECTED_FIELDS_CACHE.set(key, {
      fields,
      expires: Date.now() + STUDIO_URL_TTL,
    });

    return fields;
  }

  /** Whatever this schema calls the human-readable name of a document. */
  private titleOf(document: any) {
    return (
      document?.title ||
      document?.name ||
      document?.heading ||
      document?.headline ||
      document?.label ||
      document?.subject ||
      ''
    );
  }

  private publishedId(id: string) {
    return id.startsWith(DRAFT_PREFIX) ? id.slice(DRAFT_PREFIX.length) : id;
  }

  /**
   * Collapse the raw `drafts.x` / `x` pairs the raw perspective returns into one
   * row per document, the way an author thinks about it.
   */
  private summarise(
    credentials: SanityCredentials,
    rows: SanityRow[],
    sitePrefix = ''
  ): SanityDocumentSummary[] {
    const documents = new Map<
      string,
      SanityDocumentSummary & { draftUpdatedAt: string }
    >();

    for (const row of rows || []) {
      const isDraft = row._id.startsWith(DRAFT_PREFIX);
      const id = this.publishedId(row._id);
      const existing = documents.get(id);

      const summary: SanityDocumentSummary & { draftUpdatedAt: string } =
        existing || {
          id,
          type: row._type,
          title: '',
          slug: '',
          status: 'draft',
          hasUnpublishedChanges: false,
          updatedAt: row._updatedAt || '',
          draftUpdatedAt: '',
          image: '',
        liveUrl: '',
          editUrl: '',
        };

      if (isDraft) {
        summary.draftUpdatedAt = row._updatedAt || '';
      } else {
        summary.status = 'published';
      }

      // The draft holds the newest text, so it wins for anything displayed.
      if (isDraft || !summary.title) {
        summary.title = row.title || summary.title || '';
        summary.slug = row.slug || summary.slug || '';
      }

      summary.image = summary.image || row.image || '';

      summary.type = summary.type || row._type;
      if ((row._updatedAt || '') > summary.updatedAt) {
        summary.updatedAt = row._updatedAt || '';
      }

      documents.set(id, summary);
    }

    return [...documents.values()].map((summary) => {
      const { draftUpdatedAt, ...rest } = summary;
      return {
        ...rest,
        // A draft sitting on top of a published document means there are edits
        // the reader of the site cannot see yet.
        hasUnpublishedChanges: rest.status === 'published' && !!draftUpdatedAt,
        // A published post can be read on the site; a draft cannot.
        liveUrl:
          rest.status === 'published' && sitePrefix && rest.slug
            ? `${sitePrefix}${rest.slug}`
            : '',
        editUrl: this.editUrl(credentials, rest.id, rest.type),
      };
    });
  }

  @Tool({
    description:
      'List the documents in the connected Sanity dataset, with their draft / published status. Content is read live from Sanity and never stored in Voholabs Studio.',
    dataSchema: [],
  })
  async documents(token: string) {
    // `/integrations/function` turns any thrown error into a bare `false`, which
    // reaches the UI as an empty list and looks identical to "you have no
    // posts". Returning the reason instead means a broken token or an unhappy
    // Sanity says so on screen rather than silently showing nothing.
    try {
      const credentials = await this.withStudioUrl(this.decode(token));

      // Whole documents rather than a projection: whether something is an
      // article is decided by its shape, which a projection would have thrown
      // away. Only the summary is sent on - the article text stays here.
      const rows = await this.query<any[]>(
        credentials,
        `*[${LIST_FILTER}] | order(_updatedAt desc) [0...200]`
      );

      const types = this.articleTypes(rows || []);

      const articles = (rows || [])
        .filter((row) => types.has(row?._type))
        .map((row) => ({
          _id: row._id,
          _type: row._type,
          _createdAt: row._createdAt,
          _updatedAt: row._updatedAt,
          title: this.titleOf(row),
          slug: row?.slug?.current || '',
          image: this.extractImage(credentials, row),
        })) as SanityRow[];

      // A published article whose slug definitely has a page - that is what
      // the site gets asked about.
      const sampleSlug = articles.find(
        (row) => !row._id.startsWith(DRAFT_PREFIX) && row.slug
      )?.slug;

      const sitePrefix = await this.resolveSitePrefix(
        credentials,
        sampleSlug || undefined
      );

      return this.summarise(credentials, articles, sitePrefix).sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : -1
      );
    } catch (err: any) {
      console.log('Sanity documents listing failed', err?.message || err);
      return { error: err?.message || 'Could not read documents from Sanity' };
    }
  }

  @Tool({
    description:
      'Where blog posts for this channel are written. Voholabs Studio never authors them - this is the Sanity Studio to send the user to.',
    dataSchema: [],
  })
  async studioLink(token: string) {
    const credentials = await this.withStudioUrl(this.decode(token));

    // The Studio is the place to write. Without one deployed, the project's
    // management page is the only honest destination - it is at least the right
    // project, and it is where a Studio would be linked from.
    return {
      url:
        credentials.studioUrl ||
        `https://www.sanity.io/manage/project/${credentials.projectId}`,
      isStudio: !!credentials.studioUrl,
    };
  }

  /**
   * The readable text of a document, pulled out of Portable Text wherever it
   * lives. Sanity schemas name the body field whatever they like, so the shape
   * is what identifies it: an array of `block` objects whose `children` carry
   * `text`. Walking for that shape works against any schema without being told
   * the field name.
   */
  /**
   * The article as a list of things to draw, rather than as flattened text.
   *
   * A body is Portable Text: paragraphs and headings, bullet lists, and
   * whatever custom objects the schema mixes in - images with captions,
   * callouts, embeds. Flattening it to paragraphs loses exactly the parts a
   * reviewer needs to see, so each block is carried through in a shape the
   * preview can render, and anything unrecognised is skipped rather than
   * guessed at.
   */
  private renderBody(credentials: SanityCredentials, document: any) {
    const source = this.findPortableText(document);
    if (!source) {
      return [];
    }

    const blocks: any[] = [];

    const spansOf = (block: any) =>
      (block?.children || [])
        .filter((child: any) => (child?.text || '').length)
        .map((child: any) => {
          const marks: string[] = child?.marks || [];
          const link = (block?.markDefs || []).find(
            (def: any) => marks.includes(def?._key) && def?.href
          );

          return {
            text: child.text,
            bold: marks.includes('strong'),
            italic: marks.includes('em'),
            code: marks.includes('code'),
            href: link?.href,
          };
        });

    for (const block of source) {
      if (!block || typeof block !== 'object') {
        continue;
      }

      if (block._type === 'block') {
        const spans = spansOf(block);
        if (!spans.length) {
          continue;
        }

        // Consecutive list items are one list, the way they read on the page.
        if (block.listItem) {
          const previous = blocks[blocks.length - 1];
          const ordered = block.listItem === 'number';

          if (previous?.kind === 'list' && previous.ordered === ordered) {
            previous.items.push(spans);
          } else {
            blocks.push({ kind: 'list', ordered, items: [spans] });
          }

          continue;
        }

        const heading = String(block.style || '').match(/^h([1-6])$/);
        blocks.push(
          heading
            ? {
                kind: 'heading',
                level: Number(heading[1]),
                text: spans.map((s: any) => s.text).join(''),
              }
            : block.style === 'blockquote'
            ? { kind: 'quote', spans }
            : { kind: 'paragraph', spans }
        );

        continue;
      }

      // A mid-article image, the thing most often lost when a body is
      // flattened - charts and diagrams carry the argument in these posts.
      const image = this.extractImage(credentials, block);
      if (image) {
        blocks.push({
          kind: 'image',
          url: image,
          alt: block.alt || '',
          caption: block.caption || '',
        });
        continue;
      }

      // Callouts and similar: a labelled box holding a line of prose.
      const text =
        typeof block.body === 'string'
          ? block.body
          : typeof block.text === 'string'
          ? block.text
          : '';

      if (text) {
        blocks.push({
          kind: 'callout',
          style: String(block.style || block._type || 'note'),
          text,
        });
        continue;
      }

      // An embed: something that lives elsewhere and is linked to.
      if (typeof block.url === 'string' && block.url.startsWith('http')) {
        blocks.push({
          kind: 'embed',
          provider: String(block._type || 'link'),
          url: block.url,
          caption: block.caption || '',
        });
      }
    }

    return blocks;
  }

  /** The first array in the document that looks like Portable Text. */
  private findPortableText(value: any, depth = 0): any[] | undefined {
    if (!value || typeof value !== 'object' || depth > 8) {
      return undefined;
    }

    if (Array.isArray(value)) {
      if (
        value.some(
          (item) => item && typeof item === 'object' && item._type === 'block'
        )
      ) {
        return value;
      }

      for (const item of value) {
        const found = this.findPortableText(item, depth + 1);
        if (found) return found;
      }

      return undefined;
    }

    for (const child of Object.values(value)) {
      const found = this.findPortableText(child, depth + 1);
      if (found) return found;
    }

    return undefined;
  }

  private extractText(value: any, out: string[] = [], depth = 0): string[] {
    if (!value || typeof value !== 'object' || depth > 8) {
      return out;
    }

    if (Array.isArray(value)) {
      const isPortableText = value.some(
        (item) => item && typeof item === 'object' && item._type === 'block'
      );

      if (isPortableText) {
        for (const block of value) {
          const text = (block?.children || [])
            .map((child: any) => child?.text || '')
            .join('')
            .trim();

          if (!text) {
            continue;
          }

          // Headings are marked so the preview can render them as headings.
          // Without this a long article arrives as one undifferentiated wall.
          const isHeading = /^h[1-6]$/.test(String(block?.style || ''));
          out.push(isHeading ? `### ${text}` : text);
        }

        return out;
      }

      for (const item of value) {
        this.extractText(item, out, depth + 1);
      }

      return out;
    }

    for (const child of Object.values(value)) {
      this.extractText(child, out, depth + 1);
    }

    return out;
  }

  /**
   * Which document types are the articles.
   *
   * A dataset holds authors, categories and site settings next to the posts,
   * and none of those are something you publish on a schedule. Two signals
   * together separate them without knowing the schema:
   *
   * - a body of Portable Text. Settings and taxonomy have none.
   * - a publish date. This is what actually distinguishes a post from an
   *   author, because an author's bio is Portable Text too - but nobody puts a
   *   publish date on an author. Every blog schema dates the thing it
   *   publishes, whatever it calls the field.
   *
   * Judged per type, so one undated post does not remove the whole type.
   */
  private articleTypes(rows: any[]) {
    const stats = new Map<string, { withBody: number; withDate: number }>();

    for (const row of rows) {
      const type = row?._type;
      if (!type) continue;

      const entry = stats.get(type) || { withBody: 0, withDate: 0 };

      if (this.extractText(row).length > 0) {
        entry.withBody++;
      }

      if (PUBLISH_DATE_FIELDS.some((field) => row?.[field])) {
        entry.withDate++;
      }

      stats.set(type, entry);
    }

    const types = new Set<string>();

    for (const [type, entry] of stats.entries()) {
      if (entry.withBody > 0 && entry.withDate > 0) {
        types.add(type);
      }
    }

    return types;
  }

  /** Every `_ref` in a document, however deeply nested. */
  private collectReferences(value: any, found: Set<string> = new Set()) {
    if (!value || typeof value !== 'object') {
      return found;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.collectReferences(item, found);
      }
      return found;
    }

    for (const [key, child] of Object.entries(value)) {
      // Weak references are allowed to dangle by design, so they are not an
      // error the author needs to fix.
      if (key === '_ref' && typeof child === 'string' && !value._weak) {
        found.add(child);
      } else if (typeof child === 'object') {
        this.collectReferences(child, found);
      }
    }

    return found;
  }

  /**
   * The objective checks that can be made without knowing the user's Studio
   * schema: does the document still exist, does it have a name, and does every
   * reference it holds point at something real. Studio-side `required()` rules
   * are not readable over the API, so they are deliberately not attempted.
   */
  private async inspect(credentials: SanityCredentials, documentId: string) {
    const id = this.publishedId(documentId);
    const rows = await this.query<any[]>(
      credentials,
      `*[_id == $id || _id == $draftId]`,
      { id, draftId: `${DRAFT_PREFIX}${id}` }
    );

    const draft = (rows || []).find((r) => r._id.startsWith(DRAFT_PREFIX));
    const published = (rows || []).find((r) => !r._id.startsWith(DRAFT_PREFIX));
    // The draft is what a scheduled publish will push live, so it is what gets
    // validated when one exists.
    const subject = draft || published;

    if (!subject) {
      return {
        ok: false,
        errors: [
          'This document no longer exists in Sanity. It may have been deleted.',
        ],
        id,
        type: '',
        title: '',
        status: 'draft' as const,
        hasUnpublishedChanges: false,
        updatedAt: '',
        excerpt: '',
        body: [] as any[],
        image: '',
        liveUrl: '',
        editUrl: '',
      };
    }

    const errors: string[] = [];
    const title = this.titleOf(subject);

    if (!title) {
      errors.push('The document has no title.');
    }

    // Metadata the rest of this blog's posts carry but this one does not - the
    // SEO block, a cover image, a slug, whatever this schema uses.
    const expected = await this.expectedFields(credentials, subject._type || '');
    const missing = expected.filter((field) => !this.hasValue(subject[field]));

    if (missing.length) {
      errors.push(`Missing ${missing.join(', ')}.`);
    }

    const references = [...this.collectReferences(subject)];
    if (references.length) {
      const ids = [
        ...references,
        ...references.map((ref) => `${DRAFT_PREFIX}${ref}`),
      ];
      const existing = await this.query<string[]>(
        credentials,
        `*[_id in $ids]._id`,
        { ids }
      );
      const present = new Set(
        (existing || []).map((each) => this.publishedId(each))
      );
      const missing = references.filter((ref) => !present.has(ref));

      if (missing.length) {
        errors.push(
          `${missing.length} reference${
            missing.length === 1 ? '' : 's'
          } point at documents that no longer exist (${missing
            .slice(0, 3)
            .join(', ')}${missing.length > 3 ? '…' : ''}).`
        );
      }
    }

    const excerpt =
      subject.excerpt ||
      subject.description ||
      subject.summary ||
      subject.subtitle ||
      '';

    return {
      ok: errors.length === 0,
      errors,
      id,
      type: subject._type || '',
      title,
      status: (published ? 'published' : 'draft') as 'draft' | 'published',
      hasUnpublishedChanges: !!published && !!draft,
      updatedAt: subject._updatedAt || '',
      excerpt: typeof excerpt === 'string' ? excerpt : '',
      // The whole article, so it can be read and approved in Studio without a
      // trip to Sanity. Capped so one enormous post cannot bloat the response.
      // The article as blocks, so the review card can draw it the way it will
      // appear - images, callouts and lists included.
      body: this.renderBody(credentials, subject),
      image: this.extractImage(credentials, subject),
      // Only a published post has somewhere to be read.
      liveUrl: published && subject?.slug?.current
        ? await (async () => {
            const prefix = await this.resolveSitePrefix(
              credentials,
              subject.slug.current
            );
            return prefix ? `${prefix}${subject.slug.current}` : '';
          })()
        : '',
      editUrl: this.editUrl(credentials, id, subject._type || ''),
    };
  }

  @Tool({
    description:
      'Check a single Sanity document and report any problems that would stop it publishing (missing document, missing title, broken references).',
    dataSchema: [
      {
        key: 'documentId',
        type: 'string',
        description: 'The published id of the Sanity document',
      },
    ],
  })
  async validateDocument(token: string, data: { documentId: string }) {
    const credentials = await this.withStudioUrl(this.decode(token));

    try {
      return await this.inspect(credentials, data?.documentId);
    } catch (err: any) {
      // The review card needs something to render even when Sanity is down -
      // an unreachable CMS is itself worth showing in red.
      return {
        ok: false,
        errors: [
          `Could not read this document from Sanity: ${
            err?.message || 'unknown error'
          }`,
        ],
        id: data?.documentId || '',
        type: '',
        title: '',
        status: 'draft' as const,
        hasUnpublishedChanges: false,
        updatedAt: '',
        excerpt: '',
        body: [] as any[],
        image: '',
        liveUrl: '',
        editUrl: '',
      };
    }
  }

  @Tool({
    description:
      'Remove a Sanity document from Voholabs Studio. A published document is unpublished and its draft is kept; a document that only exists as a draft is deleted.',
    dataSchema: [
      {
        key: 'documentId',
        type: 'string',
        description: 'The published id of the Sanity document',
      },
    ],
  })
  async deleteDocument(token: string, data: { documentId: string }) {
    const credentials = this.decode(token);
    const id = this.publishedId(data?.documentId || '');

    if (!id) {
      return { success: false, error: 'No document id given' };
    }

    try {
      const rows = await this.query<any[]>(
        credentials,
        `*[_id == $id || _id == $draftId]{_id}`,
        { id, draftId: `${DRAFT_PREFIX}${id}` }
      );

      const hasPublished = (rows || []).some(
        (r) => !r._id.startsWith(DRAFT_PREFIX)
      );
      const hasDraft = (rows || []).some((r) =>
        r._id.startsWith(DRAFT_PREFIX)
      );

      if (hasPublished) {
        // Take it off the site but keep the writing: the draft survives so the
        // author can fix and re-publish.
        await this.dispatchActions(
          credentials,
          [
            {
              actionType: 'sanity.action.document.unpublish',
              publishedId: id,
              versionId: `${DRAFT_PREFIX}${id}`,
            },
          ],
          false
        );

        return { success: true, action: 'unpublished' };
      }

      if (hasDraft) {
        // Nothing is live, so there is no "unpublish" to do - deleting the
        // draft is what delete means here.
        await this.mutate(
          credentials,
          [{ delete: { id: `${DRAFT_PREFIX}${id}` } }],
          false
        );

        return { success: true, action: 'deleted' };
      }

      return { success: true, action: 'already-gone' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Unknown error' };
    }
  }

  /**
   * Runs while the post is being scheduled so a broken document is reported
   * when the user can still fix it, rather than as a failed publish hours
   * later. Best-effort: a Sanity outage must not block scheduling.
   */
  async validateSettings(
    integration: Integration,
    settings: SanityDto
  ): Promise<string | true> {
    const documentId = settings?.documentId;

    if (!documentId) {
      return true; // the DTO already requires it
    }

    const credentials = this.decode(integration.token);
    const result = await this.inspect(credentials, documentId);

    if (!result.ok) {
      return result.errors.join(' ');
    }

    return true;
  }

  async describeTarget(integration: Integration, settings: SanityDto) {
    if (!settings?.documentId) {
      return undefined;
    }

    try {
      const credentials = this.decode(integration.token);
      const result = await this.inspect(credentials, settings.documentId);
      return result.title || settings.documentId;
    } catch (err) {
      return settings.documentId;
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<SanityDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const credentials = this.decode(accessToken);
    const documentId = this.publishedId(
      postDetails?.[0]?.settings?.documentId || ''
    );

    if (!documentId) {
      throw new Error('No Sanity document was selected for this post');
    }

    const draftId = `${DRAFT_PREFIX}${documentId}`;
    const rows = await this.queryInActivity<any[]>(
      credentials,
      `*[_id == $id || _id == $draftId]{_id, _type}`,
      { id: documentId, draftId }
    );

    const published = (rows || []).find(
      (r) => !r._id.startsWith(DRAFT_PREFIX)
    );
    const draft = (rows || []).find((r) => r._id.startsWith(DRAFT_PREFIX));
    const type = draft?._type || published?._type || '';

    if (!draft && !published) {
      throw new Error(
        'The Sanity document no longer exists - it was deleted before its publish time'
      );
    }

    // No draft means there is nothing new to push live. The document is already
    // published, so the scheduled publish has nothing to do rather than being a
    // failure the user needs to act on.
    if (draft) {
      await this.dispatchActions(
        credentials,
        [
          {
            actionType: 'sanity.action.document.publish',
            publishedId: documentId,
            versionId: draftId,
          },
        ],
        true
      );
    }

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: documentId,
        releaseURL: this.editUrl(credentials, documentId, type),
      },
    ];
  }

  /**
   * Taking a published blog post back down. Voholabs Studio deleting its own row only
   * clears the calendar, so this is what actually removes it from the site.
   * The draft is kept, so nothing the author wrote is lost.
   */
  async deletePost(
    id: string,
    accessToken: string,
    postId: string,
    post: { settings: any; releaseURL?: string | null },
    integration: Integration
  ): Promise<boolean> {
    const credentials = this.decode(accessToken);
    const documentId = this.publishedId(
      postId || post?.settings?.documentId || ''
    );

    if (!documentId) {
      return false;
    }

    const rows = await this.queryInActivity<any[]>(
      credentials,
      `*[_id == $id]{_id}`,
      { id: documentId }
    );

    if (!(rows || []).length) {
      // Already not live - nothing to take down.
      return true;
    }

    await this.dispatchActions(
      credentials,
      [
        {
          actionType: 'sanity.action.document.unpublish',
          publishedId: documentId,
          versionId: `${DRAFT_PREFIX}${documentId}`,
        },
      ],
      true
    );

    return true;
  }
}
