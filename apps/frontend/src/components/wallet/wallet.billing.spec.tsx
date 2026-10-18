// The wallet page on the free plan: usage shows whenever there is any, and
// "Get Plus" is not offered while the wallet is on hold or while a failed
// Plus payment is being collected.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' } }),
}));
jest.mock('@gitroom/frontend/components/launches/enabled.providers', () => ({
  ENABLED_PROVIDERS: [],
}));
const usage = jest.fn();
const fetchMock = jest.fn();
let summary: any;
jest.mock('@gitroom/frontend/components/wallet/wallet.hooks', () => ({
  useWallet: () => ({ data: summary, error: undefined }),
  useWalletUsage: (...args: any[]) => usage(...args),
  useWalletPrices: () => ({ data: [] }),
  useWalletTransactions: () => ({ data: undefined }),
  useRefreshWallet: () => jest.fn(),
  // The real formatter.
  useWalletFormat: (currency?: string) =>
    jest
      .requireActual('@gitroom/frontend/components/wallet/wallet.hooks')
      .useWalletFormat(currency),
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({ tier: { current: 'FREE' }, orgId: 'org-1' }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, text: string, values: Record<string, any> = {}) =>
      String(text || '').replace(/{{(\w+)}}/g, (_m, k) =>
        String(values[k] ?? '')
      ),
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));
jest.mock('@gitroom/helpers/utils/use.fire.events', () => ({
  useFireEvents: () => jest.fn(),
  useTrackView: () => undefined,
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
jest.mock('@gitroom/frontend/components/wallet/top.up.modal', () => ({
  useIsWalletAdmin: () => true,
  cardLabel: () => 'Visa',
}));
jest.mock('@gitroom/frontend/components/wallet/wallet.header', () => ({
  ForecastNotice: () => null,
  isLow: () => false,
  lowThreshold: () => 0,
}));
jest.mock('@gitroom/frontend/components/wallet/wallet.text', () => ({
  ...jest.requireActual('@gitroom/frontend/components/wallet/wallet.text'),
  rateLine: () => '',
}));
jest.mock('@gitroom/frontend/components/wallet/wallet.return', () => ({
  WalletCheckoutReturn: () => null,
}));
jest.mock('@gitroom/frontend/components/plus/plus.panel', () => ({
  PlusPaymentFailedNotice: () => <div>Payment failed, update your card</div>,
}));
let plusPlan: any;
jest.mock('@gitroom/frontend/components/plus/plus.hooks', () => ({
  usePlusPlan: () => ({ data: plusPlan }),
}));
const openPlus = jest.fn();
jest.mock('@gitroom/frontend/components/wallet/wallet.bridge', () => ({
  openPlus: (...args: any[]) => openPlus(...args),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { FC } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WalletBillingPage } from '@gitroom/frontend/components/wallet/wallet.billing';
import { useWalletFormat } from '@gitroom/frontend/components/wallet/wallet.hooks';

const FREE = {
  balance: 7500,
  payAsYouGo: false,
  plus: false,
  plusPaymentFailed: false,
  topUpAllowed: false,
  credits: { plan: 0, topUp: 7500, planResetsAt: null },
  frozen: false,
  currency: 'USD',
  paymentsEnabled: true,
  topUp: { minAmount: 1000, options: [1000], creditsPerUnit: 20 },
  card: null,
  autoTopUp: {
    enabled: false,
    threshold: null,
    amount: null,
    monthlyCap: null,
    usedThisMonth: 0,
  },
};
const getPlus = () => screen.queryByRole('link', { name: /Get Plus/ });

beforeEach(() => {
  openPlus.mockReset();
  fetchMock.mockReset();
  usage.mockReset();
  usage.mockReturnValue({ data: undefined, isLoading: false });
});

describe('Wallet page on the free plan', () => {
  it('reads and shows usage without Plus', () => {
    summary = FREE;
    usage.mockReturnValue({
      data: {
        byDay: [{ day: new Date().toISOString().slice(0, 10), total: 2500 }],
        byAction: [
          { key: 'ai.image', name: 'AI image', quantity: 1, total: 2500 },
        ],
      },
      isLoading: false,
    });
    render(<WalletBillingPage />);
    expect(usage).toHaveBeenCalledWith(30);
    expect(screen.queryByText('No usage yet')).toBeNull();
    expect(screen.getAllByText('AI image').length).toBeGreaterThan(0);
  });

  it('says what shows there without talk of topping up', () => {
    summary = FREE;
    usage.mockReturnValue({
      data: { byDay: [], byAction: [] },
      isLoading: false,
    });
    const { container } = render(<WalletBillingPage />);
    expect(screen.getByText('No usage yet')).not.toBeNull();
    expect(container.textContent).not.toMatch(/once you top up/i);
  });

  it('offers Plus on the free plan', () => {
    summary = FREE;
    render(<WalletBillingPage />);
    expect(getPlus()).not.toBeNull();
  });

  it('offers no Plus while the wallet is on hold', () => {
    summary = { ...FREE, frozen: true };
    render(<WalletBillingPage />);
    expect(screen.getByText(/on hold/)).not.toBeNull();
    expect(getPlus()).toBeNull();
  });

  it('asks for the card, not a second Plus, after a failed payment', () => {
    summary = { ...FREE, plusPaymentFailed: true };
    render(<WalletBillingPage />);
    expect(screen.getByText('Payment failed, update your card')).not.toBeNull();
    expect(getPlus()).toBeNull();
  });

  it('shows the free balance in the normal text colour', () => {
    summary = FREE;
    render(<WalletBillingPage />);
    const balance = screen.getAllByText('75.00')[0].parentElement;
    expect(balance?.className || '').not.toMatch(/textItemBlur/);
  });

  it('opens Plus from the locked auto top-up switch and settings', () => {
    summary = FREE;
    const { container } = render(<WalletBillingPage />);
    expect(container.textContent).toMatch(/Auto top-up comes with Plus\./);
    expect(container.textContent).not.toMatch(/when you top up|first top-up/i);
    const toggle = screen.getByRole('switch', { name: 'Auto top-up' });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(toggle.querySelector('svg')).not.toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Get Plus' }));
    // The locked settings (thresholds, amounts) open it too.
    fireEvent.click(container.querySelector('button[aria-hidden="true"]')!);
    expect(openPlus).toHaveBeenCalledTimes(3);
  });
});

describe('Top-up rate line', () => {
  const { rateLine } = jest.requireActual(
    '@gitroom/frontend/components/wallet/wallet.text'
  );
  const t = (_k: string, text: string, v: Record<string, any> = {}) =>
    text.replace(/{{(\w+)}}/g, (_m, k) => String(v[k] ?? ''));
  const Line: FC<{ perUnit: number }> = ({ perUnit }) => {
    const f = useWalletFormat('USD');
    return (
      <span>
        {rateLine(t, f, {
          ...FREE,
          topUp: { ...FREE.topUp, creditsPerUnit: perUnit },
        })}
      </span>
    );
  };

  it('has no decimals for a whole rate', () => {
    render(<Line perUnit={19} />);
    expect(screen.getByText('$1 = 19 credits')).not.toBeNull();
  });

  it('keeps two decimals otherwise', () => {
    render(<Line perUnit={19.5} />);
    expect(screen.getByText('$1 = 19.50 credits')).not.toBeNull();
  });
});

describe('Auto top-up with Plus', () => {
  const PLUS = {
    ...FREE,
    payAsYouGo: true,
    plus: true,
    topUpAllowed: true,
    card: { brand: 'visa', last4: '4242', exp: '12/2030' },
  };
  const toggle = () => screen.getByRole('switch', { name: 'Auto top-up' });

  it('shows the card saved at subscribe, and can be turned on at once', () => {
    summary = PLUS;
    render(<WalletBillingPage />);
    expect(screen.getAllByText('Visa').length).toBeGreaterThan(0);
    expect((toggle() as HTMLButtonElement).disabled).toBe(false);
  });

  it('without a card, turning it on saves a card first', async () => {
    summary = { ...PLUS, card: null };
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<WalletBillingPage />);
    expect(screen.getByText(/Turn this on to save a card/)).not.toBeNull();
    await act(async () => {
      fireEvent.click(toggle());
    });
    expect(fetchMock).toHaveBeenCalledWith('/wallet/card', {
      method: 'POST',
      body: JSON.stringify({ autoTopUp: true }),
    });
  });

  it('is Plus only on the free plan', () => {
    summary = FREE;
    render(<WalletBillingPage />);
    expect(screen.getByText(/comes with Plus/)).not.toBeNull();
    // Locked, not dead: the switch opens Plus instead of saving.
    fireEvent.click(toggle()!);
    expect(openPlus).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says it is paused while the Plus payment is failing', () => {
    summary = {
      ...PLUS,
      plus: false,
      topUpAllowed: false,
      plusPaymentFailed: true,
      autoTopUp: { ...PLUS.autoTopUp, enabled: true },
    };
    render(<WalletBillingPage />);
    expect(screen.getByText(/paused while your Plus payment is failing/)).not.toBeNull();
  });

  it('says why it turned off', () => {
    summary = {
      ...FREE,
      plus: false,
      autoTopUp: { ...FREE.autoTopUp, offReason: 'plus_ended' },
    };
    render(<WalletBillingPage />);
    expect(screen.getByText(/turned off when your Plus ended/)).not.toBeNull();
    summary = { ...PLUS, autoTopUp: { ...PLUS.autoTopUp, offReason: 'card_failed' } };
    render(<WalletBillingPage />);
    expect(screen.getByText(/your card could not be charged/)).not.toBeNull();
  });
});

describe('Pay-as-you-go from before Plus', () => {
  const LEGACY = {
    ...FREE,
    balance: 0,
    credits: { plan: 0, topUp: 0, planResetsAt: null },
    payAsYouGo: true,
    legacy: true,
    topUpAllowed: true,
    card: { brand: 'visa', last4: '4242', exp: '12/2030' },
  };

  it('keeps Top up and auto top-up, and offers Plus as an option', () => {
    summary = LEGACY;
    plusPlan = {
      offer: {
        currency: 'USD',
        creditsPerPeriod: 400,
        intervals: [{ interval: 'month', price: 1900 }],
      },
    };
    render(<WalletBillingPage />);
    expect(screen.getByRole('button', { name: /Top up/ })).not.toBeNull();
    expect(getPlus()).toBeNull();
    expect(screen.queryByText(/comes with Plus/)).toBeNull();
    expect(
      (screen.getByRole('switch', { name: 'Auto top-up' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(
      screen.getByText(/Plus gives you 400 credits a month for \$19/)
    ).not.toBeNull();
    expect(screen.getByRole('link', { name: 'See Plus' })).not.toBeNull();
  });

  it('shows auto top-up paused, not editable, while a Plus payment is failing', () => {
    summary = { ...LEGACY, plusPaymentFailed: true };
    render(<WalletBillingPage />);
    expect(screen.getByText(/paused while your Plus payment is failing/)).not.toBeNull();
    expect(
      (screen.getByRole('switch', { name: 'Auto top-up' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});
