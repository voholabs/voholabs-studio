import { INestApplication } from '@nestjs/common';
import { Request, Response } from 'express';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { MCPServer } from '@mastra/mcp';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { runWithContext } from './async.storage';
import { createOAuthMiddleware } from './oauth-middleware';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { paidToolNames } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import { hasAccess } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';
import { UPLOAD_WIDGET_URI, uploadWidgetHtml } from '@gitroom/nestjs-libraries/chat/ui/upload.widget';
import { CLIPPING_WIDGET_URI, clippingWidgetHtml } from '@gitroom/nestjs-libraries/chat/ui/clipping.widget';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
const fixAcceptHeader = (req: Request) => {
  const value = 'application/json, text/event-stream';
  req.headers.accept = value;
  const idx = req.rawHeaders.findIndex((h) => h.toLowerCase() === 'accept');
  if (idx !== -1) {
    req.rawHeaders[idx + 1] = value;
  } else {
    req.rawHeaders.push('Accept', value);
  }
};

const openAiOAuthClientId = process.env.OPENAI_OAUTH_CLIENT_ID?.trim();
const enableOidcEmailClaims = Boolean(openAiOAuthClientId);
const oauthScopes = [
  ...(enableOidcEmailClaims ? ['openid', 'email'] : []),
  'mcp:read',
  'mcp:write',
];

export const startMcp = async (app: INestApplication) => {
  const mastraService = app.get(MastraService, { strict: false });
  const organizationService = app.get(OrganizationService, { strict: false });
  const oauthService = app.get(OAuthService, { strict: false });
  const loadToolsService = app.get(LoadToolsService, { strict: false });

  const resolveAuth = async (token: string) => {
    if (token.startsWith('pos_')) {
      const authorization = await oauthService.getOrgByOAuthToken(token);
      if (!authorization) return null;
      return authorization.organization;
    }
    return organizationService.getOrgByApiKey(token);
  };

  // The free plan keeps the MCP, and the paid tools refuse on their own (see
  // paidOnly), so nothing is turned away here for its plan. These routes are
  // raw middleware and never reach the Nest throttler, hence a limit of their
  // own: a fixed window per organization. Redis being down must not take the
  // MCP with it, so a failed count lets the request through.
  // Paying organizations run agents that post in bulk, so their ceiling is only
  // there to stop a runaway loop. The free plan gets a tighter one.
  const paidLimit = Number(process.env.MCP_LIMIT_PER_MINUTE || 1200);
  const freeLimit = Number(process.env.MCP_FREE_LIMIT_PER_MINUTE || 120);
  const rateLimited = async (org: any, res: Response) => {
    const mcpLimit = hasAccess(org) ? paidLimit : freeLimit;
    try {
      const key = `mcp_limit:${org.id}:${Math.floor(Date.now() / 60000)}`;
      const total = await ioRedis.incr(key);
      if (total === 1) {
        await ioRedis.expire(key, 60);
      }
      if (total <= mcpLimit) {
        return false;
      }
    } catch (err) {
      return false;
    }

    res.status(429).json({
      error: 'rate_limited',
      error_description: 'Too many requests, slow down and try again in a minute.',
    });

    return true;
  };

  const mastra = await mastraService.mastra();
  const agent = mastra.getAgent('postiz');
  const tools = {
    ...(await agent.listTools()),
    // tools that only make sense inside an MCP host (ui:// widgets)
    ...(await loadToolsService.loadTools(true)),
  };

  // The Claude connector directory does not accept AI media generation tools,
  // so the directory-facing endpoint hides them. Direct connections
  // (/mcp, /mcp/:id, /sse/:id) and the ChatGPT app keep the full toolset.
  const claudeHiddenTools = [
    'generateImageTool',
    'generateVideoTool',
    'videoStatusTool',
    'generateVideoOptions',
    'videoFunctionTool',
    // clipping renders new videos (AI picked cuts, burned-in captions)
    'clippingTool',
    'clippingStatusTool',
    'clippingWidgetTicketTool',
  ];
  const claudeTools = Object.fromEntries(
    Object.entries(tools).filter(([name]) => !claudeHiddenTools.includes(name))
  ) as typeof tools;

  const backendUrl = process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
  // this runs before the backend listens: a bucket url that doesn't parse only
  // costs the widget its thumbnails, never the boot
  let storageOrigin: string | undefined;
  try {
    storageOrigin = new URL(UploadFactory.createStorage().publicUrl!('')).origin;
  } catch (err) {}

  // MCP Apps widgets (ui:// resources). They run in the host's sandboxed iframe,
  // which can only reach the domains listed in the csp
  const appResources = {
    [UPLOAD_WIDGET_URI]: {
      name: 'Upload Media',
      description: 'Upload an image or video from the device to the media library',
      html: uploadWidgetHtml(backendUrl!),
      meta: {
        csp: { connectDomains: [new URL(backendUrl!).origin] },
        // the "Copy link" button of the uploaded media
        permissions: { clipboardWrite: {} },
        prefersBorder: true,
      },
    },
    ...(UploadFactory.clippingEnabled()
      ? {
          [CLIPPING_WIDGET_URI]: {
            name: 'Video Clipping',
            description: 'Progress of a video clipping and the clips it made',
            html: clippingWidgetHtml(backendUrl!),
            meta: {
              csp: {
                connectDomains: [new URL(backendUrl!).origin],
                // the thumbnails of the clips live wherever the storage serves files
                ...(storageOrigin ? { resourceDomains: [storageOrigin] } : {}),
              },
              // the "Copy link" button of a clip
              permissions: { clipboardWrite: {} },
              prefersBorder: true,
            },
          },
        }
      : {}),
  };

  const serverConfig = {
    name: 'Voholabs MCP',
    version: '1.0.0',
    tools,
    // Registering the agent here is what publishes `ask_postiz`: MCPServer
    // generates an `ask_<name>` tool for every agent in this map. That tool
    // hands the whole job to Studio's own agent, which needs its own OpenAI key
    // and goes around the writer entirely, so there is no card, no draft file
    // and nothing for the batch check. `agent` above stays, because
    // listTools() still needs it.
    // agents: { postiz: agent },
    appResources,
  };

  const server = new MCPServer(serverConfig);

  // What a free organization is served: the same server without the paid tools.
  // The tool map cannot vary per request, a whole server can.
  const withoutTools = <T extends { tools: Record<string, any> }>(
    config: T,
    hidden: string[]
  ): T => ({
    ...config,
    tools: Object.fromEntries(
      Object.entries(config.tools).filter(([name]) => !hidden.includes(name))
    ),
  });
  const freeServerConfig = withoutTools(serverConfig, paidToolNames);
  const freeServer = new MCPServer(freeServerConfig);
  const serverFor = (org: any) => (hasAccess(org) ? server : freeServer);

  // a widget of a hidden tool is hidden with it
  const { [CLIPPING_WIDGET_URI]: hiddenWidget, ...claudeAppResources } = appResources as Record<string, (typeof appResources)[typeof UPLOAD_WIDGET_URI]>;

  // The Claude connector directory server: the agent is never registered on
  // any server here (see serverConfig), so none of them exposes the
  // annotation-less catch-all ask_postiz tool the directory reviews reject
  const claudeServerConfig = {
    ...serverConfig,
    tools: claudeTools,
    appResources: claudeAppResources,
  };
  const claudeServer = new MCPServer(claudeServerConfig);
  const claudeFreeServer = new MCPServer(
    withoutTools(claudeServerConfig, paidToolNames)
  );
  const claudeServerFor = (org: any) =>
    hasAccess(org) ? claudeServer : claudeFreeServer;

  // Two RFC 8414 path-based issuers backed by the same endpoints and code.
  // /mcp-oauth-chatgpt is what the ChatGPT app submission points at: it does
  // not advertise a registration_endpoint, so the OpenAI builder defaults to
  // the pre-defined client credentials instead of DCR (a fresh path, because
  // OpenAI kept serving its cached copy of the old /mcp-oauth metadata).
  // /mcp-oauth-dynamic keeps DCR for Claude, Cursor and every other
  // self-registering client
  const authorizationServers: Record<string, { issuer: string; registration: boolean }> = {
    '/mcp-oauth-chatgpt': {
      issuer: new URL('/mcp-oauth-chatgpt', process.env.NEXT_PUBLIC_BACKEND_URL!).toString(),
      registration: false,
    },
    '/mcp-oauth-dynamic': {
      issuer: new URL('/mcp-oauth-dynamic', process.env.NEXT_PUBLIC_BACKEND_URL!).toString(),
      registration: true,
    },
  };

  const authorizationServerMetadata = (server: { issuer: string; registration: boolean }) => ({
    // RFC 8414: metadata served at /.well-known/oauth-authorization-server/<path>
    // belongs to the path-based issuer <backend>/<path>
    issuer: server.issuer,
    authorization_endpoint: `${process.env.FRONTEND_URL}/oauth/authorize`,
    token_endpoint: `${backendUrl}/oauth/token`,
    ...(server.registration && {
      registration_endpoint: `${backendUrl}/oauth/register`,
    }),
    ...(enableOidcEmailClaims && {
      userinfo_endpoint: `${backendUrl}/oauth/userinfo`,
    }),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: oauthScopes,
  });

  // Every OAuth-protected MCP path is its own RFC 9728 protected resource
  // (the token endpoint ignores the RFC 8707 resource param, so the issuers
  // above cover all of them)
  const createResourceMiddleware = (mcpPath: string, authorizationServer: string) =>
    createOAuthMiddleware({
      oauth: {
        resource: new URL(mcpPath, process.env.NEXT_PUBLIC_BACKEND_URL!).toString(),
        authorizationServers: [authorizationServers[authorizationServer].issuer],
        scopesSupported: oauthScopes,
        validateToken: async (token: string) => {
          const org = await resolveAuth(token);
          if (!org) {
            return { valid: false, error: 'invalid_token', errorDescription: 'Invalid API Key or OAuth token' };
          }
          return { valid: true, subject: token };
        },
      },
      mcpPath,
    });

  const oauthResources: Record<
    string,
    {
      middleware: ReturnType<typeof createOAuthMiddleware>;
      mcpServerFor: (org: any) => MCPServer;
    }
  > = {
    // ChatGPT app submission (pre-defined client credentials, no DCR)
    '/mcp-oauth-chatgpt': { middleware: createResourceMiddleware('/mcp-oauth-chatgpt', '/mcp-oauth-chatgpt'), mcpServerFor: serverFor },
    // Former ChatGPT path, kept for connectors that were created against it
    '/mcp-oauth': { middleware: createResourceMiddleware('/mcp-oauth', '/mcp-oauth-dynamic'), mcpServerFor: serverFor },
    // Claude connector directory submission
    '/mcp-oauth-claude': { middleware: createResourceMiddleware('/mcp-oauth-claude', '/mcp-oauth-dynamic'), mcpServerFor: claudeServerFor },
    // Clients that register themselves through DCR (/oauth/register) - not
    // directory-reviewed, so they get the full toolset (media generation included)
    '/mcp-oauth-dynamic': { middleware: createResourceMiddleware('/mcp-oauth-dynamic', '/mcp-oauth-dynamic'), mcpServerFor: serverFor },
  };

  if (process.env.OPENAI_APP_CHALLANGE) {
    app.use('/.well-known/openai-apps-challenge', (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/plain');
      res.send(process.env.OPENAI_APP_CHALLANGE);
    });
  }

  app.use('/.well-known/oauth-protected-resource', async (req: Request, res: Response, next: () => void) => {
    // Only the paths in oauthResources are OAuth-protected.
    // Answering discovery on any other path (including the root, which clients
    // fall back to) makes them demand OAuth for /mcp/:id too
    const resource = oauthResources[req.path];
    if (!resource) {
      next();
      return;
    }

    const url = new URL('/.well-known/oauth-protected-resource', process.env.NEXT_PUBLIC_BACKEND_URL);
    await resource.middleware(req, res, url);
  });

  app.use('/.well-known/oauth-authorization-server', async (req: Request, res: Response, next: () => void) => {
    const server = authorizationServers[req.path];
    if (!server) {
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'max-age=3600');
    res.json(authorizationServerMetadata(server));
  });

  app.use('/.well-known/openid-configuration', async (req: Request, res: Response, next: () => void) => {
    const server = authorizationServers[req.path];
    if (!server || !enableOidcEmailClaims) {
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'max-age=3600');
    res.json({
      ...authorizationServerMetadata(server),
      subject_types_supported: ['public'],
      claims_supported: ['sub', 'email', 'email_verified'],
    });
  });

  app.use(Object.keys(oauthResources), async (req: Request, res: Response, next: () => void) => {
    // Skip if this is the /mcp/:id route
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    // baseUrl is the mount path that matched, e.g. /mcp-oauth-claude
    const { middleware, mcpServerFor } = oauthResources[req.baseUrl];
    const url = new URL(req.baseUrl, process.env.NEXT_PUBLIC_BACKEND_URL);

    const result = await middleware(req, res, url);
    if (!result.proceed) return;

    const token = result.tokenValidation?.subject;
    const auth = await resolveAuth(token!);
    if (!auth) {
      res.status(401).json({ error: 'invalid_token', error_description: 'Could not resolve organization' });
      return;
    }

    if (await rateLimited(auth, res)) {
      return;
    }

    fixAcceptHeader(req);
    await runWithContext({ requestId: token!, auth }, async () => {
      await mcpServerFor(auth).startHTTP({
        url: url,
        httpPath: url.pathname,
        options: {
          // Stateless: every request is served by a transient server and
          // transport, so nothing is retained per session and a redeploy
          // leaves no client holding a session id the server no longer knows.
          serverless: true,
          enableJsonResponse: true,
        },
        req,
        res,
      });
    });
  });

  app.use('/mcp', async (req: Request, res: Response, next: () => void) => {
    // Skip if this is the /mcp/:id route
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    // @ts-ignore
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(401).send('Missing Authorization header');
      return;
    }

    // @ts-ignore
    req.auth = await resolveAuth(token);
    // @ts-ignore
    if (!req.auth) {
      res.status(401).send('Invalid API Key or OAuth token');
      return;
    }

    // @ts-ignore
    if (await rateLimited(req.auth, res)) {
      return;
    }

    const url = new URL('/mcp', process.env.NEXT_PUBLIC_BACKEND_URL);

    fixAcceptHeader(req);
    // @ts-ignore
    await runWithContext({ requestId: token, auth: req.auth }, async () => {
      // @ts-ignore
      await serverFor(req.auth).startHTTP({
        url,
        httpPath: url.pathname,
        options: {
          // Stateless: every request is served by a transient server and
          // transport, so nothing is retained per session and a redeploy
          // leaves no client holding a session id the server no longer knows.
          serverless: true,
          enableJsonResponse: true,
        },
        req,
        res,
      });
    });
  });

  app.use('/mcp/:id', async (req: Request, res: Response) => {
    // @ts-ignore
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    // @ts-ignore
    req.auth = await organizationService.getOrgByApiKey(req.params.id);
    // @ts-ignore
    if (!req.auth) {
      res.status(400).send('Invalid API Key');
      return;
    }

    // @ts-ignore
    if (await rateLimited(req.auth, res)) {
      return;
    }

    const url = new URL(
      `/mcp/${req.params.id}`,
      process.env.NEXT_PUBLIC_BACKEND_URL
    );

    fixAcceptHeader(req);
    await runWithContext(
      // @ts-ignore
      { requestId: req.params.id, auth: req.auth },
      async () => {
        // @ts-ignore
        await serverFor(req.auth).startHTTP({
          url,
          httpPath: url.pathname,
          options: {
            // Stateless, for the same reason as the routes above.
            serverless: true,
            enableJsonResponse: true,
          },
          req,
          res,
        });
      }
    );
  });

  app.use(['/sse/:id', '/message/:id'], async (req: Request, res: Response) => {
    // @ts-ignore
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    // @ts-ignore
    req.auth = await organizationService.getOrgByApiKey(req.params.id);
    // @ts-ignore
    if (!req.auth) {
      res.status(400).send('Invalid API Key');
      return;
    }

    // @ts-ignore
    if (await rateLimited(req.auth, res)) {
      return;
    }

    const url = new URL(req.originalUrl, process.env.NEXT_PUBLIC_BACKEND_URL);

    await runWithContext(
      // @ts-ignore
      { requestId: req.params.id, auth: req.auth },
      async () => {
        await new MCPServer(
          // @ts-ignore
          hasAccess(req.auth) ? serverConfig : freeServerConfig
        ).startSSE({
          url,
          ssePath: `/sse/${req.params.id}`,
          messagePath: `/message/${req.params.id}`,
          req,
          res,
        });
      }
    );
  });
};
