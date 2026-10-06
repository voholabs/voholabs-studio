import { INestApplication } from '@nestjs/common';
import { Request, Response } from 'express';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { MCPServer } from '@mastra/mcp';
import { mcpOnlyToolList } from '@gitroom/nestjs-libraries/chat/tools/mcp.only.tool.list';
import {
  UPLOAD_WIDGET_URI,
  r2UploadOrigins,
  uploadWidgetHtml,
} from '@gitroom/nestjs-libraries/chat/ui/upload.widget';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { runWithContext } from './async.storage';
import { createOAuthMiddleware } from './oauth-middleware';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  notOnPlanToolNames,
  paidToolNames,
  walletToolKeys,
  walletToolNames,
} from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { hasAccess } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';
import { bufferJsonBody } from '@gitroom/nestjs-libraries/chat/mcp.body';
import { trackAgentConnection } from '@gitroom/nestjs-libraries/track/product.analytics';
import { AgentConnectionService } from '@gitroom/nestjs-libraries/database/prisma/agent-connections/agent-connection.service';
import {
  AgentConnectionRecorder,
  McpRequestSeen,
} from '@gitroom/nestjs-libraries/database/prisma/agent-connections/agent-connection.recorder';
const authMethodOf = (token?: string): McpRequestSeen['authMethod'] =>
  token?.startsWith('pos_') ? 'OAUTH' : 'API_KEY';

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

export const startMcp = async (app: INestApplication) => {
  const mastraService = app.get(MastraService, { strict: false });
  const organizationService = app.get(OrganizationService, { strict: false });
  const oauthService = app.get(OAuthService, { strict: false });

  const walletService = app.get(WalletService, { strict: false });
  const agentConnectionService = app.get(AgentConnectionService, {
    strict: false,
  });

  // Logs which agents reach the MCP (AgentConnection). Never awaited.
  const recorder = new AgentConnectionRecorder(
    (input) => agentConnectionService.record(input),
    (input, { first }) =>
      trackAgentConnection(input.organizationId, first, {
        client: input.client,
        auth_method: input.authMethod,
      })
  );
  const noteConnection = (
    req: Request,
    organizationId: string,
    authMethod: McpRequestSeen['authMethod']
  ) =>
    recorder.seen({
      organizationId,
      authMethod,
      userAgent: req.headers['user-agent'],
      // @ts-ignore
      body: req.body,
    });

  // Lists what this workspace's wallet top-up has opened (see paidOnly and
  // walletToolNames). Any of it also earns the paid rate limit.
  // A paid plan never uses the wallet, so its requests skip the wallet tables.
  const withWallet = async <T extends { id: string } | null>(org: T) => {
    if (org && !hasAccess(org as any)) {
      (org as any).walletUnlocks = await walletService
        .unlockedKeys(org.id)
        .catch((): string[] => []);
    }
    return org;
  };

  const resolveAuth = async (token: string) => {
    if (token.startsWith('pos_')) {
      const authorization = await oauthService.getOrgByOAuthToken(token);
      if (!authorization) return null;
      return withWallet(authorization.organization);
    }
    return withWallet(await organizationService.getOrgByApiKey(token));
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
    const mcpLimit =
      hasAccess(org) || org?.walletUnlocks?.length ? paidLimit : freeLimit;
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
  const tools = await agent.listTools();

  // Tools that need an MCP host (the upload box) and its ui:// page, served to
  // every plan.
  const widgetTools = Object.fromEntries(
    await Promise.all(
      mcpOnlyToolList.map(async (tool) => {
        const instance = app.get(tool, { strict: false });
        return [instance.name, await instance.run()] as const;
      })
    )
  );
  const widgetBackend = (
    process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL!
  ).replace(/\/+$/, '');
  const appResources = {
    [UPLOAD_WIDGET_URI]: {
      name: 'Upload media',
      description:
        'Upload photos and videos from the device to the Voholabs Studio media library',
      html: uploadWidgetHtml(widgetBackend),
      meta: {
        // The iframe may only reach these: the backend, which signs each part,
        // and the bucket each part is sent to.
        csp: {
          connectDomains: [
            new URL(widgetBackend).origin,
            ...r2UploadOrigins(),
          ],
        },
        prefersBorder: true,
      },
    },
  };

  // What a paid plan is served: every tool except the wallet's and the
  // skills library.
  const serverConfig = {
    name: 'Voholabs MCP',
    version: '1.0.0',
    tools: {
      ...Object.fromEntries(
        Object.entries(tools).filter(
          ([name]) => !notOnPlanToolNames.includes(name)
        )
      ),
      ...widgetTools,
    },
    appResources,
    // Registering the agent here is what publishes `ask_postiz`: MCPServer
    // generates an `ask_<name>` tool for every agent in this map. That tool
    // hands the whole job to Studio's own agent, which needs its own OpenAI key
    // and goes around the writer entirely, so there is no card, no draft file
    // and nothing for the batch check. `agent` above stays, because
    // listTools() still needs it.
    // agents: { postiz: agent },
  };

  const server = new MCPServer(serverConfig);

  // What a free organization is served: the same server without the paid tools.
  // The tool map cannot vary per request, a whole server can.
  const freeServerConfig = {
    ...serverConfig,
    tools: {
      ...Object.fromEntries(
        Object.entries(tools).filter(([name]) => !paidToolNames.includes(name))
      ),
      ...widgetTools,
    },
    appResources,
  };
  const freeServer = new MCPServer(freeServerConfig);

  // A pay-as-you-go workspace: the free tools plus the ones a wallet top-up
  // opens.
  const walletServerConfig = {
    ...serverConfig,
    tools: {
      ...Object.fromEntries(
        Object.entries(tools).filter(
          ([name]) =>
            !paidToolNames.includes(name) || walletToolNames.includes(name)
        )
      ),
      ...widgetTools,
    },
    appResources,
  };
  const walletServer = new MCPServer(walletServerConfig);

  // The wallet server once the top-up opens any of its features (the brief or
  // the skills); each of its tools still checks its own key (paidOnly).
  const opensWalletTools = (org: any) =>
    walletToolKeys.some((key) => org?.walletUnlocks?.includes(key));
  const configFor = (org: any) =>
    hasAccess(org)
      ? serverConfig
      : opensWalletTools(org)
      ? walletServerConfig
      : freeServerConfig;
  // The sign-in endpoint (/mcp-oauth) is the one listed in the Claude and
  // ChatGPT directories, which accept neither AI media generation nor a
  // single tool that both reads and writes another service's API. It leaves
  // those out; the key-in-URL endpoints keep every tool.
  const directoryHiddenTools = [
    'mediaMcpList',
    'mediaMcpCall',
    'sanityMcpList',
    'sanityMcpCall',
  ];
  const forDirectory = (config: typeof serverConfig) =>
    new MCPServer({
      ...config,
      tools: Object.fromEntries(
        Object.entries(config.tools).filter(
          ([name]) => !directoryHiddenTools.includes(name)
        )
      ) as typeof config.tools,
    });
  const directoryServer = forDirectory(serverConfig);
  const directoryFreeServer = forDirectory(freeServerConfig);
  const directoryWalletServer = forDirectory(walletServerConfig);
  const directoryServerFor = (org: any) =>
    hasAccess(org)
      ? directoryServer
      : opensWalletTools(org)
      ? directoryWalletServer
      : directoryFreeServer;

  const serverFor = (org: any) =>
    hasAccess(org)
      ? server
      : opensWalletTools(org)
      ? walletServer
      : freeServer;

  // The backend is served under a path (/api behind nginx), and
  // new URL('/x', base) would drop it, so advertised URLs are joined by hand.
  // The issuer is the backend URL itself; nginx serves its RFC 8414 path-inserted
  // metadata (/.well-known/oauth-authorization-server/api) from the backend.
  const backendBase = process.env.NEXT_PUBLIC_BACKEND_URL!.replace(/\/+$/, '');
  const advertised = (path: string) => `${backendBase}${path}`;

  const oauthMiddleware = createOAuthMiddleware({
    resourceMetadataUrl: advertised('/.well-known/oauth-protected-resource'),
    oauth: {
      resource: advertised('/mcp-oauth'),
      authorizationServers: [backendBase],
      validateToken: async (token: string) => {
        const org = await resolveAuth(token);
        if (!org) {
          return { valid: false, error: 'invalid_token', errorDescription: 'Invalid API Key or OAuth token' };
        }
        return { valid: true, subject: token };
      },
    },
    mcpPath: '/mcp-oauth',
  });

  if (process.env.OPENAI_APP_CHALLANGE) {
    app.use('/.well-known/openai-apps-challenge', (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/plain');
      res.send(process.env.OPENAI_APP_CHALLANGE);
    });
  }

  app.use('/.well-known/oauth-protected-resource', async (req: Request, res: Response) => {
    const url = new URL('/.well-known/oauth-protected-resource', process.env.NEXT_PUBLIC_BACKEND_URL);
    await oauthMiddleware(req, res, url);
  });

  app.use('/.well-known/oauth-authorization-server', async (req: Request, res: Response) => {
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
    const tokenBase = (
      process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL || backendBase
    ).replace(/\/+$/, '');
    res.json({
      issuer: backendBase,
      authorization_endpoint: `${process.env.FRONTEND_URL}/oauth/authorize`,
      token_endpoint: `${tokenBase}/oauth/token`,
      // Dynamic client registration, so an AI assistant can connect without
      // anyone creating an app for it first.
      registration_endpoint: `${tokenBase}/oauth/register`,
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:read', 'mcp:write'],
    });
  });

  app.use('/mcp-oauth', async (req: Request, res: Response, next: () => void) => {
    // Skip if this is the /mcp/:id route
    if (req.path !== '/' && req.path !== '') {
      next();
      return;
    }

    const url = new URL('/mcp-oauth', process.env.NEXT_PUBLIC_BACKEND_URL);

    const result = await oauthMiddleware(req, res, url);
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
    if (!(await bufferJsonBody(req, res))) {
      return;
    }
    noteConnection(req, auth.id, authMethodOf(token));

    fixAcceptHeader(req);
    await runWithContext({ requestId: token!, auth }, async () => {
      await directoryServerFor(auth).startHTTP({
        url: url,
        httpPath: url.pathname,
        options: {
          // Stateless: sessions live only in the memory of one process, so a
          // redeploy invalidates every client's session id. Mastra then answers
          // an unknown session with 400, and the MCP spec only tells a client to
          // re-initialise on 404 — so the client is stuck reporting an expired
          // session until it is disconnected and reconnected by hand. Without a
          // session there is nothing to expire and a restart goes unnoticed.
          sessionIdGenerator: undefined,
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
    if (!(await bufferJsonBody(req, res))) {
      return;
    }
    // @ts-ignore
    noteConnection(req, req.auth.id, authMethodOf(token));

    const url = new URL('/mcp', process.env.NEXT_PUBLIC_BACKEND_URL);

    fixAcceptHeader(req);
    // @ts-ignore
    await runWithContext({ requestId: token, auth: req.auth }, async () => {
      // @ts-ignore
      await serverFor(req.auth).startHTTP({
        url,
        httpPath: url.pathname,
        options: {
          // Stateless: sessions live only in the memory of one process, so a
          // redeploy invalidates every client's session id. Mastra then answers
          // an unknown session with 400, and the MCP spec only tells a client to
          // re-initialise on 404 — so the client is stuck reporting an expired
          // session until it is disconnected and reconnected by hand. Without a
          // session there is nothing to expire and a restart goes unnoticed.
          sessionIdGenerator: undefined,
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
    req.auth = await withWallet(
      await organizationService.getOrgByApiKey(req.params.id as string)
    );
    // @ts-ignore
    if (!req.auth) {
      res.status(400).send('Invalid API Key');
      return;
    }

    // @ts-ignore
    if (await rateLimited(req.auth, res)) {
      return;
    }
    if (!(await bufferJsonBody(req, res))) {
      return;
    }
    // @ts-ignore
    noteConnection(req, req.auth.id, 'API_KEY');

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
            // Stateless, for the same reason as the routes above: a session
            // only exists in one process's memory, so a redeploy leaves every
            // client holding an id the server no longer knows.
            sessionIdGenerator: undefined,
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
    req.auth = await withWallet(
      await organizationService.getOrgByApiKey(req.params.id as string)
    );
    // @ts-ignore
    if (!req.auth) {
      res.status(400).send('Invalid API Key');
      return;
    }

    // @ts-ignore
    if (await rateLimited(req.auth, res)) {
      return;
    }
    // The legacy SSE transport reads its own body, so only the User-Agent is
    // seen here.
    // @ts-ignore
    noteConnection(req, req.auth.id, 'API_KEY');

    const url = new URL(req.originalUrl, process.env.NEXT_PUBLIC_BACKEND_URL);

    await runWithContext(
      // @ts-ignore
      { requestId: req.params.id, auth: req.auth },
      async () => {
        await new MCPServer(
          // @ts-ignore
          configFor(req.auth)
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
