/**
 * What is kept in Redis under `organization:${state}` while a channel connect
 * is in progress, and how it is read back.
 *
 * - `session`: started from the app by a signed-in member. The request that
 *   finishes the connect has to come from a signed-in member of the same
 *   organization.
 * - `api`: started without a browser session (public API key, CLI, enterprise
 *   provisioning). The person finishing it is usually not a Studio user at all,
 *   so there is no credential to ask them for. What ties the callback to the
 *   organization is the state itself: random (32 characters from makeState,
 *   or the provider's own request token), known only to the one the provider
 *   redirected, and removed once the channel is connected.
 * - `legacy`: a plain organization id, written before this record existed.
 *   Those expire within the hour they were given, so this branch only has to
 *   carry flows that were already open across a deploy.
 *
 * Once a two-step provider (pages, companies) is connected, the record moves to
 * the `pages` step: it can then only choose the page of that one channel, and
 * cannot be used to connect another.
 */
export type ConnectVia = 'session' | 'api' | 'legacy';

export interface ConnectStateRecord {
  orgId: string;
  via: ConnectVia;
  userId?: string;
  // Set after the channel itself is connected, for the page selection step.
  integrationId?: string;
}

export const CONNECT_STATE_TTL_SECONDS = 3600;

export const connectStateKey = (state: string) => `organization:${state}`;

export const serializeConnectState = (record: ConnectStateRecord) =>
  JSON.stringify(record);

export const parseConnectState = (
  raw: string | null | undefined
): ConnectStateRecord | null => {
  if (!raw) {
    return null;
  }

  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.orgId === 'string' &&
        parsed.orgId &&
        ['session', 'api', 'legacy'].includes(parsed.via)
      ) {
        return {
          orgId: parsed.orgId,
          via: parsed.via,
          ...(typeof parsed.userId === 'string' ? { userId: parsed.userId } : {}),
          ...(typeof parsed.integrationId === 'string'
            ? { integrationId: parsed.integrationId }
            : {}),
        };
      }
    } catch (err) {}
    return null;
  }

  return { orgId: raw, via: 'legacy' };
};

export interface ConnectSessionLookups {
  verifyJWT: (token: string) => unknown;
  getUserById: (
    id: string
  ) => Promise<{ id: string; activated: boolean; isSuperAdmin: boolean } | null>;
  getOrgsByUserId: (
    userId: string
  ) => Promise<{ id: string; users?: { disabled: boolean }[] }[]>;
}

/**
 * Whether the request finishing a connect may do so. Only a `session` record
 * asks anything of it: a signed-in, activated member of the organization the
 * connect was started for (or a super admin, who may have started it while
 * impersonating that member). `auth` is the same cookie or header the rest of
 * the app reads.
 */
export const canFinishConnect = async (
  record: ConnectStateRecord,
  auth: string | undefined,
  lookups: ConnectSessionLookups
) => {
  if (record.via !== 'session') {
    return true;
  }

  if (!auth) {
    return false;
  }

  let payload: { id?: string } | null = null;
  try {
    payload = lookups.verifyJWT(auth) as { id?: string } | null;
  } catch (err) {
    return false;
  }

  if (!payload?.id) {
    return false;
  }

  const user = await lookups.getUserById(payload.id);
  if (!user || !user.activated) {
    return false;
  }

  if (user.isSuperAdmin) {
    return true;
  }

  return (await lookups.getOrgsByUserId(user.id)).some(
    (org) => org.id === record.orgId && !org.users?.[0]?.disabled
  );
};
