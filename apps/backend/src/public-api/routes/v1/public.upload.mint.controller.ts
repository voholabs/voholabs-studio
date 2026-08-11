import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { randomBytes } from 'crypto';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  UPLOAD_TICKET_TTL_SECONDS,
  uploadTicketKey,
} from '@gitroom/nestjs-libraries/upload/upload.ticket';

/**
 * Mints an upload ticket over HTTP, for an API-key caller putting a file into
 * the media library.
 *
 * The ticket mechanism already existed but could only be minted from MCP, which
 * needs a chat session. A server integration has an API key and no session, so
 * it had no way in. This is the mint half only: the file itself still goes to
 * the existing PublicUploadTicketController, which stays unauthenticated
 * because the ticket in its URL is the credential.
 *
 * Nothing about the ticket changes here — same 256-bit token, same TTL, same
 * single-use burn, same organization scoping.
 */
@ApiTags('Public API')
@Controller('/public/v1')
@CheckPolicies([AuthorizationActions.Create, Sections.AI])
export class PublicUploadMintController {
  @Post('/upload-ticket')
  async mint(@GetOrgFromRequest() org: Organization) {
    const token = randomBytes(32).toString('hex');
    await ioRedis.set(
      uploadTicketKey(token),
      org.id,
      'EX',
      UPLOAD_TICKET_TTL_SECONDS
    );

    const base = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');

    return {
      uploadUrl: `${base}/public/v1/upload-ticket/${token}`,
      expiresInSeconds: UPLOAD_TICKET_TTL_SECONDS,
      // Says how to use it, because the receiving route takes multipart form
      // data rather than the JSON every other endpoint here expects.
      field: 'file',
    };
  }
}
