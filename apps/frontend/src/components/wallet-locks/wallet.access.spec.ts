let mockUser: any;
let mockPrices: any;
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => mockUser,
}));
jest.mock('@gitroom/frontend/components/wallet/wallet.hooks', () => ({
  useWalletPrices: (enabled = true) => ({
    data: enabled ? mockPrices : undefined,
  }),
}));

import { renderHook } from '@testing-library/react';
import {
  lockedAmongSelected,
  paidChannelProviders,
  postPriceRange,
  useTopUpProviders,
  useWalletAccess,
} from '@gitroom/frontend/components/wallet-locks/wallet.access';

// Which channels onboarding leaves without the "Free" tag: those whose price
// rows need Plus or charge per post, read from the rows only.

const action = (over: Record<string, any>) => ({
  key: 'k',
  provider: null,
  category: null,
  name: 'n',
  description: null,
  unit: 'post',
  freeUnits: 0,
  freePeriod: null,
  billing: 'MONTHLY',
  requiresTopUp: false,
  price: 1,
  ...over,
});

describe('paidChannelProviders', () => {
  it('takes providers that need Plus or charge per use, and nothing else', () => {
    const paid = paidChannelProviders([
      {
        key: 'channels',
        actions: [
          action({ key: 'x.post', provider: 'x', billing: 'PER_USE', requiresTopUp: true }),
          action({ key: 'p.post', provider: 'plus-only', requiresTopUp: true }),
          action({ key: 'm.post', provider: 'metered', billing: 'PER_USE' }),
          action({ key: 'f.post', provider: 'free-row' }),
          action({ key: 'nobody', billing: 'PER_USE', requiresTopUp: true }),
        ],
      },
    ]);
    expect([...paid].sort()).toEqual(['metered', 'plus-only', 'x']);
    expect(paid.has('instagram')).toBe(false);
  });

  it('is empty without price rows', () => {
    expect(paidChannelProviders([]).size).toBe(0);
  });
});

describe('postPriceRange', () => {
  // X's rows: two posting prices, and a read, a repost and a lookup.
  const x = [
    {
      key: 'channels',
      actions: [
        action({ key: 'x.post', provider: 'x', unit: 'post', price: 45 }),
        action({ key: 'x.post_link', provider: 'x', unit: 'post', price: 600 }),
        action({ key: 'x.post_read', provider: 'x', unit: 'read', price: 15 }),
        action({ key: 'x.repost', provider: 'x', unit: 'repost', price: 45 }),
        action({ key: 'x.user_lookup', provider: 'x', unit: 'lookup', price: 30 }),
        action({ key: 'xing.post', provider: 'xing', unit: 'post', price: 5 }),
      ],
    },
  ];

  it('spans the posting rows only, by their unit', () => {
    expect(postPriceRange(x, 'x')).toEqual({ low: 45, high: 600 });
  });

  it('is null for a channel without posting rows', () => {
    expect(postPriceRange(x, 'linkedin')).toBeNull();
    expect(postPriceRange([], 'x')).toBeNull();
  });
});

describe('lockedAmongSelected', () => {
  it('names a locked channel only when it is selected', () => {
    const locked = new Set(['x']);
    expect(lockedAmongSelected(locked, ['linkedin'])).toEqual([]);
    expect(lockedAmongSelected(locked, [])).toEqual([]);
    expect(lockedAmongSelected(locked, ['linkedin', 'x', 'x'])).toEqual(['x']);
  });
});

// Pay-as-you-go from before Plus comes as payAsYouGo on /user/self (the
// server opens it at any balance): the locks treat it as open.
describe('wallet locks', () => {
  beforeEach(() => {
    mockPrices = [
      {
        key: 'channels',
        actions: [
          action({ key: 'x.post', provider: 'x', billing: 'PER_USE', requiresTopUp: true }),
        ],
      },
    ];
  });

  it('opens everything to pay-as-you-go from before Plus', () => {
    mockUser = { tier: { current: 'FREE' }, payAsYouGo: true };
    expect(renderHook(() => useWalletAccess()).result.current).toBe('payg');
    expect(renderHook(() => useTopUpProviders()).result.current.size).toBe(0);
  });

  it('locks what Plus opens on the free plan', () => {
    mockUser = { tier: { current: 'FREE' }, payAsYouGo: false };
    expect(renderHook(() => useWalletAccess()).result.current).toBe('free');
    expect([...renderHook(() => useTopUpProviders()).result.current]).toEqual([
      'x',
    ]);
  });
});
