import { Injectable } from '@nestjs/common';
import {
  decryptLegacySecret,
  encryptSecret,
  lookupHash,
} from '@gitroom/helpers/auth/auth.service';
import {
  StoredSecret,
  StoredSecretsRepository,
} from '@gitroom/nestjs-libraries/database/prisma/stored-secrets/stored-secrets.repository';

@Injectable()
export class StoredSecretsService {
  constructor(private _storedSecretsRepository: StoredSecretsRepository) {}

  // Every column that held a credential under the older JWT_SECRET
  // encryption. `encrypt`: read back, so encrypted under ENCRYPTION_KEY.
  // `hash`: only ever compared, so kept as a keyed hash. Authorization codes
  // are left out: they expire within ten minutes and the lookup still accepts
  // the older form. The organization apiKey is not here: the stored value is
  // the key itself, nothing decrypts it.
  private columns() {
    const repository = this._storedSecretsRepository;
    return [
      {
        column: 'Organization.hermesApiKey',
        kind: 'encrypt' as const,
        load: () => repository.organizationSecrets('hermesApiKey'),
        write: (id: string, from: string, to: string) =>
          repository.rewriteOrganizationSecret('hermesApiKey', id, from, to),
      },
      {
        column: 'Organization.mediaMeterKey',
        kind: 'encrypt' as const,
        load: () => repository.organizationSecrets('mediaMeterKey'),
        write: (id: string, from: string, to: string) =>
          repository.rewriteOrganizationSecret('mediaMeterKey', id, from, to),
      },
      {
        column: 'ThirdParty.apiKey',
        kind: 'encrypt' as const,
        load: () => repository.thirdPartyKeys(),
        write: (id: string, from: string, to: string) =>
          repository.rewriteThirdPartyKey(id, from, to),
      },
      {
        column: 'Integration.customInstanceDetails',
        kind: 'encrypt' as const,
        load: () => repository.integrationDetails(),
        write: (id: string, from: string, to: string) =>
          repository.rewriteIntegrationDetails(id, from, to),
      },
      {
        column: 'OAuthSelfHostedAuthorization.apiKey',
        kind: 'encrypt' as const,
        load: () => repository.selfHostedSecrets('apiKey'),
        write: (id: string, from: string, to: string) =>
          repository.rewriteSelfHostedSecret('apiKey', id, from, to),
      },
      {
        column: 'OAuthApp.clientSecret',
        kind: 'hash' as const,
        load: () => repository.oauthAppSecrets(),
        write: (id: string, from: string, to: string) =>
          repository.rewriteOAuthAppSecret(id, from, to),
      },
      {
        column: 'OAuthAuthorization.accessToken',
        kind: 'hash' as const,
        load: () => repository.oauthAccessTokens(),
        write: (id: string, from: string, to: string) =>
          repository.rewriteOAuthAccessToken(id, from, to),
      },
      {
        column: 'OAuthSelfHostedAuthorization.accessToken',
        kind: 'hash' as const,
        load: () => repository.selfHostedSecrets('accessToken'),
        write: (id: string, from: string, to: string) =>
          repository.rewriteSelfHostedSecret('accessToken', id, from, to),
      },
    ];
  }

  // Moves the credentials stored with the older JWT_SECRET encryption to
  // ENCRYPTION_KEY, so JWT_SECRET can be rotated without breaking them.
  // A value that is not the older encryption is left alone (`unreadable`).
  // Without `apply` it only reports.
  async moveToEncryptionKey(apply: boolean) {
    const columns = [];
    for (const { column, kind, load, write } of this.columns()) {
      const rows: StoredSecret[] = await load();
      let moved = 0;
      let unreadable = 0;
      const skipped: string[] = [];
      const failed: string[] = [];

      for (const row of rows) {
        const plain = decryptLegacySecret(row.value);
        if (plain === null) {
          unreadable++;
          continue;
        }
        if (!apply) {
          continue;
        }
        try {
          const written = await write(
            row.id,
            row.value,
            kind === 'hash' ? lookupHash(plain) : encryptSecret(plain)
          );
          if (written) {
            moved++;
          } else {
            skipped.push(row.id);
          }
        } catch (err) {
          failed.push(row.id);
        }
      }

      columns.push({
        column,
        legacy: rows.length - unreadable,
        unreadable,
        moved,
        skipped,
        failed,
      });
    }

    return { dryRun: !apply, columns };
  }
}
