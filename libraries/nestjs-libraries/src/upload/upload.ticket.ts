// Short-lived, single-use tickets that let an agent push a local file into the
// media library without ever holding the organization's API key.
//
// The MCP tool mints a ticket (it is already authenticated as the org) and
// hands back a URL; the agent POSTs the file to that URL as multipart form
// data. The receiving route is unauthenticated by design — the ticket itself
// is the credential — so it is a 256-bit random token, expires quickly, is
// burned on the first successful upload, and can only ever add a file to the
// organization it was minted for.
export const UPLOAD_TICKET_TTL_SECONDS = 900;

export const uploadTicketKey = (token: string) => `mcp:upload-ticket:${token}`;

// The same kind of ticket for the brief onboarding, which may also carry
// documents (see brief.upload.ts). Kept under its own key so an ordinary
// ticket can never be used for a document.
export const briefUploadTicketKey = (token: string) =>
  `mcp:brief-upload-ticket:${token}`;

export interface ClaimedUploadTicket {
  organizationId: string;
  // Milliseconds the ticket had left when it was claimed.
  ttl: number;
}

/**
 * Takes a ticket in one step, so two uploads racing on the same ticket cannot
 * both get it. A failed upload hands it back with `releaseUploadTicket`, so it
 * can still be retried within what was left of its life.
 */
export const claimUploadTicket = async (
  redis: any,
  key: string
): Promise<ClaimedUploadTicket | null> => {
  if (typeof redis.multi !== 'function') {
    // The in-memory stand-in used without REDIS_URL has no transactions.
    const organizationId = await redis.get(key);
    if (!organizationId) {
      return null;
    }
    await redis.del(key);
    return { organizationId, ttl: UPLOAD_TICKET_TTL_SECONDS * 1000 };
  }

  const result = await redis.multi().pttl(key).getdel(key).exec();
  const ttl = Number(result?.[0]?.[1]);
  const organizationId = result?.[1]?.[1];
  if (!organizationId) {
    return null;
  }
  return {
    organizationId: String(organizationId),
    ttl: ttl > 0 ? ttl : UPLOAD_TICKET_TTL_SECONDS * 1000,
  };
};

export const releaseUploadTicket = async (
  redis: any,
  key: string,
  ticket: ClaimedUploadTicket
) => {
  // NX: never overwrite a ticket that was minted again in the meantime.
  await redis.set(key, ticket.organizationId, 'PX', ticket.ttl, 'NX');
};
