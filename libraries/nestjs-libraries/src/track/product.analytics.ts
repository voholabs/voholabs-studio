import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// Product events that only the server sees (a post going out, an MCP client
// connecting), sent to the same PostHog project as the app's own events.
// Uses the app's public project key, so it is on exactly when the app's
// analytics are; without the key nothing is sent anywhere.
//
// These events belong to an organization, not to a person: there is no
// person behind a scheduled publish. They carry `org_id`, like every event
// from the app does, so a funnel counted by organization joins both.

const key = () => process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = () =>
  (process.env.NEXT_PUBLIC_POSTHOG_HOST || '').replace(/\/+$/, '');

export const productAnalyticsEnabled = () => !!key() && !!host();

// Fire and forget: never awaited by the caller, never throws.
export const captureOrgEvent = (
  orgId: string,
  event: string,
  properties: Record<string, unknown> = {}
) => {
  if (!productAnalyticsEnabled() || !orgId) {
    return;
  }
  fetch(`${host()}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key(),
      event,
      distinct_id: `org_${orgId}`,
      properties: {
        ...properties,
        org_id: orgId,
        app: 'studio',
        source: 'server',
        // Do not create a person for the organization.
        $process_person_profile: false,
      },
      timestamp: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // Analytics must never fail the work that fired it.
  });
};

// After an agent connection is written (see AgentConnectionRecorder):
// `mcp_connected` when it is the organization's first agent connection ever
// (Organization.agentFirstConnectedAt was empty), `mcp_active` once a day
// otherwise. An organization the old Redis marker already knew connected
// before connections were stored, so it counts as active, not as new.
export const trackAgentConnection = async (
  orgId: string,
  first: boolean,
  properties: { client: string; auth_method: string }
) => {
  if (!productAnalyticsEnabled() || !orgId) {
    return;
  }
  try {
    const day = new Date().toISOString().slice(0, 10);
    const freshToday = await ioRedis.set(
      `analytics:mcp:${orgId}:${day}`,
      '1',
      'EX',
      60 * 60 * 26,
      'NX'
    );
    if (first) {
      const neverSeen = await ioRedis.set(
        `analytics:mcp:${orgId}:seen`,
        '1',
        'NX'
      );
      if (neverSeen === 'OK') {
        captureOrgEvent(orgId, 'mcp_connected', properties);
        return;
      }
    }
    if (freshToday === 'OK') {
      captureOrgEvent(orgId, 'mcp_active', properties);
    }
  } catch {
    // Redis being down must not touch the MCP.
  }
};
