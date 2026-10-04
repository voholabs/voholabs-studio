jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert',
  () => ({ walletAlert: jest.fn(async () => undefined) })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);

import {
  STORAGE_ACTION_KEY,
  WalletStorageService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.storage.service';
import { WalletHousekeepingService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.housekeeping.service';
import { walletAlert } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert';

// WalletStorageService and the housekeeping run with stub services. Nothing
// leaves the process.

const GB = 1024 ** 3;
const FREE_PLAN = { cancelAt: new Date(Date.now() - 86_400_000) };
const PAID_PLAN = { cancelAt: null };

const monthKey = (org: string) => {
  const now = new Date();
  return `storage:${org}:${now.getUTCFullYear()}-${String(
    now.getUTCMonth() + 1
  ).padStart(2, '0')}`;
};

const build = (
  opts: {
    covered?: number;
    bytes?: number;
    balance?: number;
    pays?: boolean;
    unit?: string;
    organizations?: any[];
  } = {}
) => {
  const media = {
    getStorageUsed: jest.fn(async () => opts.bytes ?? 0),
    storageOfWalletOrganizations: jest.fn(
      async () => opts.organizations || []
    ),
  } as any;
  const wallet = {
    price: jest.fn(async (key: string) =>
      key === STORAGE_ACTION_KEY
        ? {
            price: 5000,
            action: { unit: opts.unit ?? 'gb', freeUnits: 2 },
          }
        : undefined
    ),
    paysFromWallet: jest.fn(async () => opts.pays ?? true),
    usage: jest.fn(async () => ({
      byAction: opts.covered
        ? [{ key: STORAGE_ACTION_KEY, quantity: opts.covered }]
        : [],
      byDay: [],
    })),
    balance: jest.fn(async () => opts.balance ?? 0),
  } as any;
  const billing = {
    autoTopUp: jest.fn(async () => false),
    charge: jest.fn(async (params: any) => ({
      quantity: params.quantity,
      idempotencyKey: `${params.chargeKey}#1`,
    })),
  } as any;
  const service = new WalletStorageService(media, wallet, billing);
  return { service, media, wallet, billing };
};

describe('WalletStorageService units over free', () => {
  const rule = { unitBytes: GB, freeUnits: 2 };

  it('charges nothing up to the free amount', async () => {
    const { service } = build();
    expect(service.unitsOver(0, rule)).toBe(0);
    expect(service.unitsOver(2 * GB, rule)).toBe(0);
    expect(service.unitsOver(-5, rule)).toBe(0);
  });

  it('rounds usage up to whole units above the free amount', async () => {
    const { service } = build();
    expect(service.unitsOver(2 * GB + 1, rule)).toBe(1);
    expect(service.unitsOver(3 * GB, rule)).toBe(1);
    expect(service.unitsOver(5.5 * GB, rule)).toBe(4);
  });

  it('reads the unit size and free amount from the price row', async () => {
    expect(await build().service.rule()).toEqual({
      price: 5000,
      unitBytes: GB,
      freeUnits: 2,
    });
    expect(await build({ unit: 'gb_month' }).service.rule()).toEqual(
      expect.objectContaining({ unitBytes: GB })
    );
    expect(await build({ unit: 'post' }).service.rule()).toBeUndefined();
  });
});

describe('WalletStorageService.chargeCrossing', () => {
  it('charges the month once for every unit above the free amount', async () => {
    const { service, billing } = build();
    expect(await service.chargeCrossing('org-1', 4.5 * GB)).toBe(3);
    expect(billing.charge).toHaveBeenCalledTimes(1);
    expect(billing.charge).toHaveBeenCalledWith({
      organizationId: 'org-1',
      actionKey: STORAGE_ACTION_KEY,
      chargeKey: monthKey('org-1'),
      quantity: 3,
      allowNegative: true,
    });
  });

  it('charges each further unit in the month under its own chargeKey', async () => {
    const { service, billing } = build({ covered: 1 });
    expect(await service.chargeCrossing('org-1', 4.5 * GB)).toBe(2);
    expect(billing.charge.mock.calls.map((c: any) => c[0].chargeKey)).toEqual(
      [`${monthKey('org-1')}:2`, `${monthKey('org-1')}:3`]
    );
    expect(
      billing.charge.mock.calls.every((c: any) => c[0].quantity === 1)
    ).toBe(true);
  });

  it('charges nothing for units the month already paid for', async () => {
    const { service, billing } = build({ covered: 3 });
    expect(await service.chargeCrossing('org-1', 4.5 * GB)).toBe(0);
    expect(billing.charge).not.toHaveBeenCalled();
  });

  it('skips the ledger once it knows the month is covered', async () => {
    const { service, wallet } = build();
    await service.chargeCrossing('org-1', 4.5 * GB);
    wallet.usage.mockClear();
    expect(await service.chargeCrossing('org-1', 3.5 * GB)).toBe(0);
    expect(wallet.usage).not.toHaveBeenCalled();
  });

  it('never charges an organization that does not pay from its wallet', async () => {
    const { service, billing, wallet } = build({ pays: false });
    expect(await service.chargeCrossing('org-1', 10 * GB)).toBe(0);
    expect(wallet.price).not.toHaveBeenCalled();
    expect(billing.charge).not.toHaveBeenCalled();
  });

  it('tries auto top-up first when the balance is short, then charges anyway', async () => {
    const { service, billing } = build({ balance: 100 });
    await service.chargeCrossing('org-1', 3 * GB);
    expect(billing.autoTopUp).toHaveBeenCalledWith('org-1', 5000);
    expect(billing.charge).toHaveBeenCalledWith(
      expect.objectContaining({ allowNegative: true })
    );
  });

  it('reads the library size when it is not given', async () => {
    const { service, media } = build({ bytes: 3 * GB });
    expect(await service.chargeCrossing('org-1')).toBe(1);
    expect(media.getStorageUsed).toHaveBeenCalledWith('org-1');
  });
});

describe('WalletStorageService.monthPass', () => {
  it('charges wallet organizations above the free amount and skips paid plans', async () => {
    const { service, billing } = build({
      organizations: [
        { organizationId: 'a', subscription: FREE_PLAN, bytes: 3 * GB },
        { organizationId: 'b', subscription: PAID_PLAN, bytes: 9 * GB },
        { organizationId: 'c', subscription: FREE_PLAN, bytes: GB },
      ],
    });
    expect(await service.monthPass()).toEqual({
      charged: 1,
      organizations: 1,
    });
    expect(billing.charge).toHaveBeenCalledTimes(1);
    expect(billing.charge.mock.calls[0][0].chargeKey).toBe(monthKey('a'));
  });
});

describe('WalletHousekeepingService', () => {
  const housekeeping = (organizations: any[] = []) => {
    const media = {
      storageOfWalletOrganizations: jest.fn(async () => organizations),
    } as any;
    const wallet = { notifyIfShort: jest.fn(async () => true) } as any;
    const billing = {
      reconcile: jest.fn(async (days: number) => ({
        days,
        since: new Date(),
        stripeOnly: [{}],
        ledgerOnly: [],
        mismatched: [],
      })),
    } as any;
    const storage = {
      monthPass: jest.fn(async () => ({ charged: 0, organizations: 0 })),
    } as any;
    return {
      service: new WalletHousekeepingService(media, wallet, billing, storage),
      wallet,
      billing,
    };
  };

  const env = process.env.WALLET_STRIPE_SECRET_KEY;
  afterEach(() => {
    process.env.WALLET_STRIPE_SECRET_KEY = env;
    jest.useRealTimers();
  });

  it('sends short-forecast notices to wallet organizations not on a paid plan', async () => {
    const { service, wallet } = housekeeping([
      { organizationId: 'a', subscription: FREE_PLAN },
      { organizationId: 'b', subscription: PAID_PLAN },
    ]);
    const result = await service.run();
    expect(result.notified).toBe(1);
    expect(wallet.notifyIfShort).toHaveBeenCalledTimes(1);
    expect(wallet.notifyIfShort).toHaveBeenCalledWith('a');
  });

  it('reconciles once a day and alerts on a difference', async () => {
    process.env.WALLET_STRIPE_SECRET_KEY = 'sk_test_stub';
    jest.useFakeTimers({
      now: new Date(Date.UTC(2026, 9, 4, 12)),
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
    const { service, billing } = housekeeping();
    expect((await service.run()).reconciled).toBe(true);
    expect((await service.run()).reconciled).toBe(false);
    expect(billing.reconcile).toHaveBeenCalledTimes(1);
    expect(walletAlert).toHaveBeenCalledWith(
      expect.stringContaining('1 paid in Stripe but not credited')
    );
  });

  it('does not reconcile without wallet payments', async () => {
    delete process.env.WALLET_STRIPE_SECRET_KEY;
    const { service, billing } = housekeeping();
    expect((await service.run()).reconciled).toBe(false);
    expect(billing.reconcile).not.toHaveBeenCalled();
  });
});
