jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert',
  () => ({ walletAlert: jest.fn(async () => undefined) })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);

import { createHmac } from 'crypto';
import { HttpException } from '@nestjs/common';
import {
  BriefOnboardingService,
  briefOnboardingChargeKey,
} from '@gitroom/nestjs-libraries/database/prisma/brief/brief.onboarding.service';

// BriefOnboardingService with an in-memory repository and stub wallet.

const SECRET = 'x'.repeat(40);
const ORG = 'org-1';
const USER = { email: 'a@b.com', name: 'Ann' };

const build = (
  opts: { pays?: boolean; free?: number | null; balance?: number } = {}
) => {
  const rows: any[] = [];
  let next = 1;
  const repository = {
    create: jest.fn(async (organizationId: string) => {
      const row = {
        id: `run-${next++}`,
        organizationId,
        status: 'RUNNING',
        chargeKey: null,
        error: null,
        createdAt: new Date(),
        finishedAt: null,
      };
      rows.push(row);
      return row;
    }),
    getById: jest.fn(
      async (id: string) => rows.find((r) => r.id === id) || null
    ),
    running: jest.fn(
      async (org: string) =>
        rows.find((r) => r.organizationId === org && r.status === 'RUNNING') ||
        null
    ),
    last: jest.fn(
      async (org: string) =>
        [...rows]
          .reverse()
          .find((r) => r.organizationId === org && r.status !== 'RUNNING') ||
        null
    ),
    staleRunning: jest.fn(async (org: string, before: Date) =>
      rows.filter(
        (r) =>
          r.organizationId === org &&
          r.status === 'RUNNING' &&
          r.createdAt < before
      )
    ),
    update: jest.fn(async (id: string, data: any) => {
      const row = rows.find((r) => r.id === id);
      Object.assign(row, data);
      return row;
    }),
  } as any;
  const wallet = {
    paysFromWallet: jest.fn(async () => opts.pays ?? true),
    freeUnitsRemaining: jest.fn(async () =>
      opts.free === undefined ? 1 : opts.free
    ),
    price: jest.fn(async () => ({ price: 100, action: {} })),
    balance: jest.fn(async () => opts.balance ?? 0),
    refund: jest.fn(async () => ({})),
  } as any;
  const billing = {
    charge: jest.fn(async (params: any) => ({
      idempotencyKey: params.chargeKey,
    })),
  } as any;
  const service = new BriefOnboardingService(repository, wallet, billing);
  return { service, rows, wallet, billing };
};

const readToken = (url: string) => {
  const token = new URL(url).searchParams.get('st')!;
  const [payload, signature] = token.split('.');
  return {
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
    valid:
      createHmac('sha256', SECRET).update(payload).digest('base64url') ===
      signature,
  };
};

describe('BriefOnboardingService', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.BRIEF_ONBOARDING_URL = 'https://site.test/brief/start';
    process.env.BRIEF_ONBOARDING_SECRET = SECRET;
  });
  afterAll(() => {
    process.env = env;
  });

  it('is unavailable when the env is not set', async () => {
    delete process.env.BRIEF_ONBOARDING_SECRET;
    const { service } = build();
    await expect(service.start(ORG, USER)).rejects.toMatchObject({
      status: 404,
    });
    process.env.BRIEF_ONBOARDING_SECRET = 'short';
    await expect(service.start(ORG, USER)).rejects.toBeInstanceOf(
      HttpException
    );
  });

  it('returns a signed link carrying the run, org, user and language', async () => {
    const { service } = build();
    const { id, url } = await service.start(ORG, USER, 'fr');
    expect(url.startsWith('https://site.test/brief/start?st=')).toBe(true);
    expect(new URL(url).searchParams.get('lang')).toBe('fr');
    const { payload, valid } = readToken(url);
    expect(valid).toBe(true);
    expect(payload).toMatchObject({
      v: 1,
      r: id,
      o: ORG,
      e: USER.email,
      n: USER.name,
      l: 'fr',
    });
    expect(payload.exp).toBeGreaterThan(Date.now());
    expect(payload.exp).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
  });

  it('falls back to the default language for an unknown one', async () => {
    const { service } = build();
    const { url } = await service.start(ORG, USER, 'xx');
    expect(readToken(url).payload.l).toBe('en');
  });

  it('reuses a running run instead of opening another', async () => {
    const { service, rows } = build();
    const first = await service.start(ORG, USER);
    const second = await service.start(ORG, USER);
    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
  });

  it('closes a stale run and opens a new one', async () => {
    const { service, rows } = build();
    const first = await service.start(ORG, USER);
    rows[0].createdAt = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const second = await service.start(ORG, USER);
    expect(second.id).not.toBe(first.id);
    expect(rows[0].status).toBe('FAILED');
  });

  it('refuses with the wallet 402 when the run cannot be paid for', async () => {
    const { service } = build({ free: 0, balance: 50 });
    await expect(service.start(ORG, USER)).rejects.toMatchObject({
      status: 402,
    });
  });

  it('charges a finished run once', async () => {
    const { service, billing } = build();
    const { id } = await service.start(ORG, USER);
    const done = await service.finish(id, ORG, 'DONE');
    expect(done).toEqual({ id, status: 'DONE', charged: true });
    await service.finish(id, ORG, 'DONE');
    expect(billing.charge).toHaveBeenCalledTimes(1);
    expect(billing.charge).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        actionKey: 'brief.onboarding',
        chargeKey: briefOnboardingChargeKey(id),
        allowNegative: true,
      })
    );
  });

  it('does not charge a workspace on a paid plan', async () => {
    const { service, billing } = build({ pays: false });
    const { id } = await service.start(ORG, USER);
    expect(await service.finish(id, ORG, 'DONE')).toMatchObject({
      charged: false,
    });
    expect(billing.charge).not.toHaveBeenCalled();
  });

  it('refunds a charged run that is reported failed', async () => {
    const { service, rows, wallet } = build();
    const { id } = await service.start(ORG, USER);
    rows[0].chargeKey = briefOnboardingChargeKey(id);
    const failed = await service.finish(id, ORG, 'FAILED', 'boom');
    expect(failed.status).toBe('FAILED');
    expect(wallet.refund).toHaveBeenCalledWith(
      briefOnboardingChargeKey(id),
      expect.any(String)
    );
    expect(rows[0].error).toBe('boom');
  });

  it('will not finish another workspace run', async () => {
    const { service } = build();
    const { id } = await service.start(ORG, USER);
    await expect(service.finish(id, 'other', 'DONE')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('reports the running and last runs', async () => {
    const { service } = build();
    const { id } = await service.start(ORG, USER);
    expect((await service.status(ORG)).running?.id).toBe(id);
    await service.finish(id, ORG, 'DONE');
    const status = await service.status(ORG);
    expect(status.running).toBeNull();
    expect(status.available).toBe(true);
    expect(status.last).toMatchObject({ id, status: 'DONE' });
  });
});
