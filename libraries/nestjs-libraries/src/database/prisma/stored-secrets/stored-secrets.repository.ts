import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ENCRYPTED_SECRET_PREFIX,
  LOOKUP_HASH_PREFIX,
} from '@gitroom/helpers/auth/auth.service';

export type StoredSecret = { id: string; value: string };

// A column holding a value not yet moved to ENCRYPTION_KEY: set, and neither
// encrypted nor hashed with it.
const notMoved = (field: string) => ({
  [field]: { not: '' },
  NOT: [
    { [field]: { startsWith: ENCRYPTED_SECRET_PREFIX } },
    { [field]: { startsWith: LOOKUP_HASH_PREFIX } },
  ],
});

const valuesOf = <F extends string>(
  rows: Array<{ id: string } & Partial<Record<F, string | null>>>,
  field: F
): StoredSecret[] =>
  rows.map((row) => ({ id: row.id, value: row[field] || '' }));

// Credentials kept with the older JWT_SECRET encryption, and their move to
// ENCRYPTION_KEY. Deleted rows are included: they still hold the credential.
// Every rewrite applies only while the row still holds the value that was
// read, so a value changed in the meantime is never overwritten; it returns
// how many rows changed.
@Injectable()
export class StoredSecretsRepository {
  constructor(
    private _organization: PrismaRepository<'organization'>,
    private _thirdParty: PrismaRepository<'thirdParty'>,
    private _integration: PrismaRepository<'integration'>,
    private _oauthApp: PrismaRepository<'oAuthApp'>,
    private _oauthAuth: PrismaRepository<'oAuthAuthorization'>,
    private _oauthSelfHosted: PrismaRepository<'oAuthSelfHostedAuthorization'>
  ) {}

  async organizationSecrets(field: 'hermesApiKey' | 'mediaMeterKey') {
    const rows = await this._organization.model.organization.findMany({
      where: notMoved(field) as Prisma.OrganizationWhereInput,
      select: { id: true, hermesApiKey: true, mediaMeterKey: true },
    });
    return valuesOf(rows, field);
  }

  async rewriteOrganizationSecret(
    field: 'hermesApiKey' | 'mediaMeterKey',
    id: string,
    from: string,
    to: string
  ) {
    const { count } = await this._organization.model.organization.updateMany({
      where: { id, [field]: from },
      data: { [field]: to },
    });
    return count;
  }

  async thirdPartyKeys() {
    const rows = await this._thirdParty.model.thirdParty.findMany({
      where: notMoved('apiKey') as Prisma.ThirdPartyWhereInput,
      select: { id: true, apiKey: true },
    });
    return valuesOf(rows, 'apiKey');
  }

  async rewriteThirdPartyKey(id: string, from: string, to: string) {
    const { count } = await this._thirdParty.model.thirdParty.updateMany({
      where: { id, apiKey: from },
      data: { apiKey: to },
    });
    return count;
  }

  async integrationDetails() {
    const rows = await this._integration.model.integration.findMany({
      where: notMoved('customInstanceDetails') as Prisma.IntegrationWhereInput,
      select: { id: true, customInstanceDetails: true },
    });
    return valuesOf(rows, 'customInstanceDetails');
  }

  async rewriteIntegrationDetails(id: string, from: string, to: string) {
    const { count } = await this._integration.model.integration.updateMany({
      where: { id, customInstanceDetails: from },
      data: { customInstanceDetails: to },
    });
    return count;
  }

  async oauthAppSecrets() {
    const rows = await this._oauthApp.model.oAuthApp.findMany({
      where: notMoved('clientSecret') as Prisma.OAuthAppWhereInput,
      select: { id: true, clientSecret: true },
    });
    return valuesOf(rows, 'clientSecret');
  }

  async rewriteOAuthAppSecret(id: string, from: string, to: string) {
    const { count } = await this._oauthApp.model.oAuthApp.updateMany({
      where: { id, clientSecret: from },
      data: { clientSecret: to },
    });
    return count;
  }

  async oauthAccessTokens() {
    const rows = await this._oauthAuth.model.oAuthAuthorization.findMany({
      where: notMoved('accessToken') as Prisma.OAuthAuthorizationWhereInput,
      select: { id: true, accessToken: true },
    });
    return valuesOf(rows, 'accessToken');
  }

  async rewriteOAuthAccessToken(id: string, from: string, to: string) {
    const { count } = await this._oauthAuth.model.oAuthAuthorization.updateMany(
      {
        where: { id, accessToken: from },
        data: { accessToken: to },
      }
    );
    return count;
  }

  async selfHostedSecrets(field: 'apiKey' | 'accessToken') {
    const rows =
      await this._oauthSelfHosted.model.oAuthSelfHostedAuthorization.findMany({
        where: notMoved(
          field
        ) as Prisma.OAuthSelfHostedAuthorizationWhereInput,
        select: { id: true, apiKey: true, accessToken: true },
      });
    return valuesOf(rows, field);
  }

  async rewriteSelfHostedSecret(
    field: 'apiKey' | 'accessToken',
    id: string,
    from: string,
    to: string
  ) {
    const { count } =
      await this._oauthSelfHosted.model.oAuthSelfHostedAuthorization.updateMany(
        {
          where: { id, [field]: from },
          data: { [field]: to },
        }
      );
    return count;
  }
}
