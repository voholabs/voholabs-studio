// The Plus offer against top-ups, and the early bird as a personal code:
// every number comes from the offer (the settings), the code copies, and it
// is gone once the countdown runs out.
const copied: string[] = [];
jest.mock('copy-to-clipboard', () => ({
  __esModule: true,
  default: (text: string) => {
    copied.push(text);
    return true;
  },
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string, values: Record<string, any> = {}) =>
    text.replace(/{{(\w+)}}/g, (_m, k) => String(values[k] ?? '')),
}));
jest.mock('@gitroom/frontend/components/wallet/wallet.hooks', () => ({
  useWalletFormat: () => ({
    number: (n: number) => String(n),
    money: (n: number) => `$${(n / 100).toFixed(2)}`,
    moneyShort: (n: number) =>
      n % 100 ? `$${(n / 100).toFixed(2)}` : `$${n / 100}`,
    factor: 100,
  }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  EarlyBirdOfferBox,
  PlusOfferCard,
} from '@gitroom/frontend/components/plus/plus.offer';
import { PlusOffer } from '@gitroom/frontend/components/plus/plus.types';

const T0 = Date.parse('2026-10-18T12:00:00.000Z');

// As GET /wallet/plus answers at 19 credits a dollar, 400 credits for $19 a
// month or $190 a year.
const OFFER: PlusOffer = {
  currency: 'USD',
  creditsPerPeriod: 400,
  periodDays: 30,
  topUpCreditsPerUnit: 19,
  intervals: [
    { interval: 'month', price: 1900, releases: 1, pricePerRelease: 1900, topUpPrice: 2105, savingPercent: 9 },
    { interval: 'year', price: 19000, releases: 12, pricePerRelease: 1583, topUpPrice: 25263, savingPercent: 24 },
  ],
};
const EARLY = {
  percent: 10,
  expiresAt: new Date(T0 + 3_000).toISOString(),
  extended: false,
  code: 'MEHR-7K2QX',
};

beforeEach(() => {
  copied.length = 0;
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});
afterEach(() => jest.useRealTimers());

// The struck-through prices: <s>, so the strike shows (a line-through on
// a parent does not reach an inline-block child).
const struck = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('s')).map((n) => n.textContent);
const card = (name: RegExp) =>
  screen.getByRole('button', { name }).closest('div.flex.flex-col.gap-\\[16px\\]') as HTMLElement;

describe('PlusOfferCard', () => {
  it('shows Monthly and Annual side by side, each against top-ups a month', () => {
    const onSubscribe = jest.fn();
    const { container } = render(<PlusOfferCard offer={OFFER} onSubscribe={onSubscribe} />);
    // Both struck prices are a month of the same credits as top-ups.
    expect(struck(container)).toEqual(['As top-ups: $21.05', 'As top-ups: $21.05']);
    const month = card(/Get Plus monthly/);
    expect(month.textContent).toContain('$19');
    expect(month.textContent).toContain('9% under top-ups');
    expect(month.textContent).toContain('Billed monthly');
    const year = card(/Get Plus annual/);
    expect(year.textContent).toContain('$15.83');
    expect(year.textContent).toContain('24% under top-ups');
    expect(year.textContent).toContain('Billed $190 a year');
    fireEvent.click(screen.getByRole('button', { name: /Get Plus annual/ }));
    expect(onSubscribe).toHaveBeenCalledWith('year');
    // No code and no discounted price without an early bird.
    expect(container.textContent).not.toContain('$17.10');
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('says what a currency unit buys: on top-ups, and on each plan', () => {
    const { container } = render(<PlusOfferCard offer={OFFER} onSubscribe={jest.fn()} />);
    expect(container.textContent).toContain('Top-ups: $1 = 19 credits');
    expect(card(/Get Plus monthly/).textContent).toContain(
      '400 credits a month$21.05 as top-ups, at $1 = 19 creditsOn Plus: $1 = 21 credits'
    );
    expect(card(/Get Plus annual/).textContent).toContain('On Plus: $1 = 25 credits');
  });

  it('follows the offer: other numbers, other output; no saving, no strike', () => {
    const { container } = render(
      <PlusOfferCard
        offer={{
          ...OFFER,
          topUpCreditsPerUnit: 20,
          intervals: [
            { ...OFFER.intervals[0], price: 2500, pricePerRelease: 2500, topUpPrice: 2000, savingPercent: 0 },
          ],
        }}
        onSubscribe={jest.fn()}
      />
    );
    expect(struck(container)).toEqual([]);
    expect(container.textContent).toContain('$25');
    expect(container.textContent).not.toContain('under top-ups');
    expect(container.textContent).toContain('Top-ups: $1 = 20 credits');
    expect(container.textContent).toContain('On Plus: $1 = 16 credits');
  });

  it('shows the personal code as a strip with the countdown and the first payments, and drops it at the end', () => {
    const onExpire = jest.fn();
    const { container } = render(
      <PlusOfferCard
        offer={OFFER}
        earlyBird={EARLY}
        onExpire={onExpire}
        onSubscribe={jest.fn()}
      />
    );
    expect(container.textContent).toContain('10% off your first payment');
    expect(container.textContent).toContain('MEHR-7K2QX');
    expect(screen.getByRole('timer').textContent).toBe('00:03');
    expect(card(/Get Plus monthly/).textContent).toContain(
      'First payment $17.10 with your code'
    );
    expect(card(/Get Plus annual/).textContent).toContain(
      'First payment $171 with your code'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(copied).toEqual(['MEHR-7K2QX']);
    expect(screen.getByRole('status').textContent).toBe('Code copied');

    act(() => {
      jest.advanceTimersByTime(3_000);
    });
    expect(container.textContent).not.toContain('MEHR-7K2QX');
    expect(container.textContent).not.toContain('with your code');
    expect(screen.queryByRole('timer')).toBeNull();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('links each plan for visitors', () => {
    render(<PlusOfferCard offer={OFFER} subscribeHref="/auth" />);
    expect(
      screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/auth')
    ).toHaveLength(2);
  });
});

describe('EarlyBirdOfferBox', () => {
  it('shows the code, the countdown and both plans against top-ups', () => {
    const { container } = render(
      <EarlyBirdOfferBox offer={OFFER} earlyBird={EARLY} offsetMs={0} />
    );
    expect(container.textContent).toContain(
      '10% off your first Plus payment with this code'
    );
    expect(container.textContent).toContain('MEHR-7K2QX');
    expect(screen.getByRole('timer').textContent).toBe('00:03');
    expect(struck(container)).toEqual(['As top-ups: $21.05', 'As top-ups: $252.63']);
    expect(container.textContent).toContain('Top-ups: $1 = 19 credits');
    expect(container.textContent).toContain('9% cheaper than top-ups');
    expect(container.textContent).toContain('24% cheaper than top-ups');
  });

  it('is nothing once expired, or without an early bird', () => {
    const expired = render(
      <EarlyBirdOfferBox
        offer={OFFER}
        earlyBird={{ ...EARLY, expiresAt: new Date(T0 - 1).toISOString() }}
        offsetMs={0}
      />
    );
    expect(expired.container.textContent).toBe('');
    const none = render(
      <EarlyBirdOfferBox offer={OFFER} earlyBird={null} offsetMs={0} />
    );
    expect(none.container.textContent).toBe('');
  });
});
