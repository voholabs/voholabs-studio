import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WalletRepository } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.repository';

// Price rows the code depends on. Created when missing, on every boot of the
// backend; a row that exists is never touched, so an admin's price stays.
export const SHIPPED_PRICE_ROWS: Prisma.BillableActionCreateInput[] = [
  // Background music and sound effects made through the MCP gateway
  // (generateMusic, generateSoundEffect and dataRun's media.music.generate /
  // media.sound.generate), charged per second of audio from credits.
  {
    key: 'ai.music',
    provider: 'ai',
    category: 'ai',
    name: 'AI music',
    unit: 'second',
    billing: 'PER_USE',
    requiresTopUp: false,
    costMicros: 2500,
  },
  {
    key: 'ai.sound',
    provider: 'ai',
    category: 'ai',
    name: 'AI sound effect',
    unit: 'second',
    billing: 'PER_USE',
    requiresTopUp: false,
    costMicros: 2000,
  },
  // Flows (the library and My flows) open with Plus: this row is what opens
  // the "flows" key (WalletService.unlockedKeys, Sections.FLOWS, paidOnly).
  {
    key: 'flows.access',
    provider: 'flows',
    category: 'flows',
    name: 'Flows',
    description: 'The flows library and My flows',
    unit: 'request',
    billing: 'UNLOCK',
    requiresTopUp: true,
    costMicros: 0,
  },
];

// Changes to existing rows, each applied once per database and only when its
// id is listed in WALLET_PRICE_REVISIONS (comma separated), so a deploy never
// reprices before the work it pays for has moved. Applied ids are recorded in
// BillingSetting, so an admin's later edit is never overwritten.
export const PRICE_REVISIONS: {
  id: string;
  costs: { key: string; costMicros: number }[];
}[] = [
  {
    // Narration and cloned voices moved to cheaper providers.
    id: 'speech-2026-11',
    costs: [
      { key: 'ai.speech', costMicros: 84_000 },
      { key: 'ai.speech.clone', costMicros: 15_000 },
    ],
  },
];

export const priceRevisionKey = (id: string) => `price_revision.${id}`;

const enabledRevisions = () =>
  (process.env.WALLET_PRICE_REVISIONS || '')
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean);

// Runs in the backend only (ApiModule). Every step is idempotent and a
// failure is logged, never thrown: a price row must not stop the app booting.
@Injectable()
export class WalletPriceRowsService implements OnApplicationBootstrap {
  private _logger = new Logger(WalletPriceRowsService.name);

  constructor(private _wallet: WalletRepository) {}

  async onApplicationBootstrap() {
    await this.sync();
  }

  async sync() {
    for (const row of SHIPPED_PRICE_ROWS) {
      try {
        await this._wallet.createActionIfMissing(row);
      } catch (err) {
        this._logger.warn(
          `Could not add the price row ${row.key}: ${
            err instanceof Error ? err.message : err
          }`
        );
      }
    }

    const enabled = enabledRevisions();
    for (const revision of PRICE_REVISIONS) {
      if (!enabled.includes(revision.id)) {
        continue;
      }
      try {
        const key = priceRevisionKey(revision.id);
        if (await this._wallet.setting(key)) {
          continue;
        }
        for (const cost of revision.costs) {
          await this._wallet.setActionCost(cost.key, cost.costMicros);
        }
        await this._wallet.saveSetting(key, new Date().toISOString());
        this._logger.log(`Applied the price revision ${revision.id}`);
      } catch (err) {
        this._logger.warn(
          `Could not apply the price revision ${revision.id}: ${
            err instanceof Error ? err.message : err
          }`
        );
      }
    }
  }
}
