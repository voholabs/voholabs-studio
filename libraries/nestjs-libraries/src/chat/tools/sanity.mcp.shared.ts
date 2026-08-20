import { MCPClient } from '@mastra/mcp';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

/**
 * Studio proxies Sanity's own hosted MCP server so an editorial agent can read
 * and write the customer's content without Studio having to re-implement the
 * Content Lake. The proxy is two tools - a list and a call - rather than N
 * statically registered ones, because the upstream tool set is Sanity's to
 * change and the boot-time tool map here is fixed.
 *
 * Everything below is an *allowlist*. A denylist would mean every tool Sanity
 * adds after this file was written is reachable until somebody notices; an
 * allowlist means it is unreachable until somebody decides.
 */

export const SANITY_PROVIDER_IDENTIFIER = 'sanity';

/**
 * The tools an editorial agent needs, and nothing else. Names verified against
 * a live `tools/list` from https://mcp.sanity.io (38 tools at time of writing).
 *
 * Read:
 *   query_documents        GROQ over the connected dataset
 *   get_document           direct lookup by document id
 *   get_schema             what the document types actually look like
 *   list_workspace_schemas resolves which schemaId get_schema should read
 *
 * Write:
 *   create_documents       creates drafts
 *   patch_documents        edits drafts
 *   publish_documents      publishes NOW - see the note on scheduling below
 *
 * Guidance (read-only, touches no customer data at all - these read Sanity's
 * public documentation and its authoring rules, and materially improve the
 * agent's GROQ):
 *   list_sanity_rules, get_sanity_rules, search_docs, read_docs
 */
export const SANITY_MCP_ALLOWLIST: ReadonlySet<string> = new Set([
  'query_documents',
  'get_document',
  'get_schema',
  'list_workspace_schemas',
  'create_documents',
  'patch_documents',
  'publish_documents',
  'list_sanity_rules',
  'get_sanity_rules',
  'search_docs',
  'read_docs',
]);

/**
 * Scheduling belongs to Studio, and only to Studio. Sanity's scheduling
 * primitive is *content releases*, so `create_release`, `list_releases`,
 * `create_version` and `version_discard` are all absent from the allowlist
 * above.
 *
 * That is not sufficient on its own. `create_documents`, `patch_documents` and
 * `unpublish_documents` each take an optional `releaseId`, and passing one
 * routes the write into a release instead of the draft - which is scheduling by
 * the back door, using a tool that is allowed. So the argument is rejected too.
 *
 * Note the distinction this does NOT make: `publish_documents` means "publish
 * now" and stays allowed. Only the *timing* of a publish belongs to Studio, and
 * blocking anything merely named "publish" would stop the agent shipping an
 * article at all.
 */
export const SANITY_MCP_FORBIDDEN_ARGUMENT = 'releaseId';

export const SANITY_MCP_SCHEDULING_REFUSAL =
  `Sanity's content releases are not available through Studio. Scheduling is Studio's job: ` +
  `use findSlotTool to pick a time and integrationSchedulePostTool to book it. ` +
  `publish_documents (publish now) is available if the article should go live immediately.`;

export const SANITY_MCP_NOT_ALLOWED = (name: string) =>
  `The Sanity tool "${name}" is not available through Studio. Call sanityMcpList to see the ` +
  `tools that are. Scheduling, dataset and project administration, schema/studio deploys and ` +
  `the Sanity CLI are deliberately not proxied.`;

export const SANITY_MCP_NOT_CONNECTED =
  'No Sanity channel is connected to this workspace, so there are no Sanity tools to use. ' +
  'Connect Sanity from the launches page first.';

export type SanityMcpCredentials = {
  projectId: string;
  dataset: string;
  token: string;
  studioUrl?: string;
};

/**
 * Overridable so a self-hoster (or a test) can point at a different Sanity MCP
 * deployment. Absent, everyone gets Sanity's hosted one, which is the only
 * behaviour that existed before.
 */
export const sanityMcpUrl = () =>
  process.env.SANITY_MCP_URL || 'https://mcp.sanity.io/mcp';

/**
 * `Integration.token` for Sanity is base64-encoded JSON, not encrypted - the
 * same shape `SanityProvider.decode` reads. It is never logged.
 */
export const resolveSanityCredentials = async (
  integrationService: IntegrationService,
  organizationId: string
): Promise<SanityMcpCredentials | null> => {
  const integrations = await integrationService.getIntegrationsList(
    organizationId
  );

  const sanity =
    integrations.find(
      (p) => p.providerIdentifier === SANITY_PROVIDER_IDENTIFIER && !p.disabled
    ) ||
    integrations.find(
      (p) => p.providerIdentifier === SANITY_PROVIDER_IDENTIFIER
    );

  if (!sanity?.token) {
    return null;
  }

  try {
    const credentials = JSON.parse(
      Buffer.from(sanity.token, 'base64').toString()
    ) as SanityMcpCredentials;

    if (!credentials?.projectId || !credentials?.dataset || !credentials?.token) {
      return null;
    }

    return credentials;
  } catch (err) {
    return null;
  }
};

/**
 * Opens a connection to Sanity's MCP server as the customer, runs `fn`, and
 * always closes it again. A fresh client per call: `MCPClient` caches by id and
 * refuses two live instances with the same configuration, and a long-lived
 * per-org client would keep an authenticated session open for every customer
 * who has ever asked a question.
 */
export const withSanityMcp = async <T>(
  credentials: SanityMcpCredentials,
  fn: (tools: Record<string, any>) => Promise<T>
): Promise<T> => {
  const client = new MCPClient({
    id: `sanity-${credentials.projectId}-${makeId(10)}`,
    servers: {
      sanity: {
        url: new URL(sanityMcpUrl()),
        requestInit: {
          headers: {
            Authorization: `Bearer ${credentials.token}`,
          },
        },
      },
    },
    timeout: 60000,
  });

  try {
    const toolsets = await client.listToolsets();
    return await fn(toolsets['sanity'] || {});
  } finally {
    await client.disconnect().catch(() => {
      // A failed disconnect is not the caller's problem and must not mask the
      // real result or the real error.
    });
  }
};

/**
 * Every Sanity data tool takes `resource: { projectId, dataset }`. Studio fills
 * it in from the connected channel rather than trusting the agent, so the proxy
 * can only ever touch the project the customer actually connected - and the
 * agent never has to be told the ids.
 */
export const scopeArgumentsToChannel = (
  args: Record<string, any>,
  inputSchema: Record<string, any> | undefined,
  credentials: SanityMcpCredentials
) => {
  const takesResource = !!inputSchema?.['properties']?.['resource'];

  if (!takesResource) {
    return args;
  }

  return {
    ...args,
    resource: {
      projectId: credentials.projectId,
      dataset: credentials.dataset,
    },
  };
};

/**
 * Mastra's MCP client hands back the server's tools already wrapped in
 * `createTool`, which stores the input schema behind a Standard Schema adapter.
 * The original JSON Schema is still in there, but which shape it takes has
 * moved between @mastra/core releases, so try each and give up quietly - a
 * missing schema costs the agent a hint, while a throw here would cost it the
 * whole tool list.
 */
export const readJsonSchema = (
  schema: any
): Record<string, any> | undefined => {
  if (!schema) {
    return undefined;
  }

  try {
    const standard = schema['~standard'];
    const input = standard?.jsonSchema?.input;

    if (typeof input === 'function') {
      return input({ target: 'draft-2020-12' });
    }

    if (standard?.jsonSchema && typeof standard.jsonSchema === 'object') {
      return standard.jsonSchema;
    }

    if (typeof schema.toJSONSchema === 'function') {
      return schema.toJSONSchema();
    }

    if (typeof schema === 'object' && 'type' in schema) {
      return schema;
    }
  } catch (err) {
    return undefined;
  }

  return undefined;
};

export const organizationIdFromContext = (context: any) =>
  JSON.parse((context?.requestContext as any)?.get('organization') as string)
    .id;
