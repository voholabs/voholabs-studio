import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class MediaMeterRepository {
  constructor(private _organization: PrismaRepository<'organization'>) {}

  getMeterKeyId(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: { id: orgId },
      select: { mediaMeterKeyId: true },
    });
  }

  getMeterCredentials(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: { id: orgId },
      select: { name: true, mediaMeterKeyId: true, mediaMeterKey: true },
    });
  }

  /**
   * Stores a freshly minted key, but only if the org still has none - the
   * `mediaMeterKey: null` condition makes two concurrent first-uses race
   * safely: exactly one write lands, and the loser's `count` is 0 so it knows
   * to re-read and use the winner's key instead of its own.
   *
   * `mediaMeterKeyId` is overwritten unconditionally alongside it: an org can
   * have a key id without the key (the id was stored for the usage panel
   * before the key column existed, and the meter returns the key only once),
   * and in that state the only way forward is a new key - so the id must
   * follow it or the usage panel would report a key nobody uses.
   */
  claimMeterKey(orgId: string, keyId: string, encryptedKey: string) {
    return this._organization.model.organization.updateMany({
      where: { id: orgId, mediaMeterKey: null },
      data: { mediaMeterKeyId: keyId, mediaMeterKey: encryptedKey },
    });
  }
}
