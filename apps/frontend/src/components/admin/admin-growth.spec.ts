// The money funnel on the growth page: each step is a share of the one
// above, and amounts are shown in their own currency.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' } }),
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => undefined,
}));
jest.mock('@gitroom/frontend/components/layout/loading', () => ({
  LoadingComponent: () => null,
}));
jest.mock('@gitroom/frontend/components/launches/enabled.providers', () => ({
  ENABLED_PROVIDERS: [],
}));

import {
  moneyFunnelRows,
  moneyText,
} from '@gitroom/frontend/components/admin/admin-growth.component';

describe('moneyFunnelRows', () => {
  const rows = moneyFunnelRows([
    {
      window: '7d',
      signups: 40,
      claimedCredits: 20,
      skippedCredits: 5,
      spentCredits: 10,
      subscribed: 4,
      subscribedMonthly: 3,
      subscribedAnnual: 1,
      subscribedNow: 2,
    },
  ]);

  it('takes each step as a share of the step before it', () => {
    expect(rows.map((r) => r.key)).toEqual([
      'signups',
      'claimed',
      'spent',
      'subscribed',
    ]);
    expect(rows[0].percentOf).toBeUndefined();
    expect(rows.slice(1).map((r) => [r.value('7d'), r.percentOf!('7d')])).toEqual([
      [20, 40],
      [10, 20],
      [4, 10],
    ]);
  });

  it('shows the skipped and the Plus split under their steps', () => {
    expect(rows[1].hint!('7d')).toBe('5 skipped');
    expect(rows[3].hint!('7d')).toBe('3 monthly · 1 annual · 2 active now');
  });

  it('reads a window without a row as zero', () => {
    expect(rows.map((r) => r.value('24h'))).toEqual([0, 0, 0, 0]);
  });
});

describe('moneyText', () => {
  it('formats smallest units in their currency, and joins currencies', () => {
    expect(moneyText([{ currency: 'USD', amount: 3710 }])).toBe('$37.10');
    expect(moneyText([{ currency: 'USD', amount: 1900 }])).toBe('$19');
    expect(
      moneyText([
        { currency: 'USD', amount: 1900 },
        { currency: 'JPY', amount: 500 },
      ])
    ).toBe('$19 + ¥500');
  });

  it('shows a dash for nothing', () => {
    expect(moneyText([])).toBe('–');
  });
});
