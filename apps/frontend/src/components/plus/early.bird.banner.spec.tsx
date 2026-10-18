// The early-bird bar runs wherever the early bird does, but is not shown on
// the Plus page, whose own code strip already shows the code and the time.
let pathname = '/launches';
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: any) => <a href={href}>{children}</a>,
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string) => text,
}));
jest.mock('@gitroom/frontend/components/plus/plus.offer', () => ({
  EarlyBirdCode: () => null,
  EarlyBirdTimer: () => null,
  PlusBadgeIcon: () => null,
}));
const plan = {
  offer: {},
  paymentsEnabled: true,
  access: { plus: false },
  subscription: null,
  clockOffsetMs: 0,
  earlyBird: {
    percent: 10,
    code: 'ANNA-ABCDE',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    extended: false,
  },
};
jest.mock('@gitroom/frontend/components/plus/plus.hooks', () => ({
  usePlusPlan: () => ({ data: plan, mutate: jest.fn() }),
}));

import { renderHook } from '@testing-library/react';
import { useEarlyBirdBanner } from '@gitroom/frontend/components/plus/early.bird.banner';

describe('useEarlyBirdBanner', () => {
  it('shows the bar outside the Plus page', () => {
    pathname = '/launches';
    const { result } = renderHook(() => useEarlyBirdBanner(true));
    expect(result.current.show).toBe(true);
    expect(result.current.running).toBe(true);
  });

  it('hides the bar on the Plus page, while the early bird still runs', () => {
    pathname = '/plus';
    const { result } = renderHook(() => useEarlyBirdBanner(true));
    expect(result.current.show).toBe(false);
    // Still running: the Apex bar does not take its place there.
    expect(result.current.running).toBe(true);
  });

  it('neither shows nor runs when it is not enabled', () => {
    pathname = '/launches';
    const { result } = renderHook(() => useEarlyBirdBanner(false));
    expect(result.current.show).toBe(false);
    expect(result.current.running).toBe(false);
  });
});
