// What the Plus page offers: never "Get Plus" while the wallet is on hold or
// while a failed payment is being collected (the card is updated instead).
const billing = jest.fn();
let plan: any;
jest.mock('@gitroom/frontend/components/plus/plus.hooks', () => ({
  usePlusPlan: () => ({ data: plan, error: undefined, mutate: jest.fn() }),
  usePlusActions: () => ({
    checkout: jest.fn(),
    confirm: jest.fn(),
    cancel: jest.fn(),
    resume: jest.fn(),
    billing,
  }),
  useApplyPlusPlan: () => jest.fn(),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string, values: Record<string, any> = {}) =>
    text.replace(/{{(\w+)}}/g, (_m, k) => String(values[k] ?? '')),
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: jest.fn(),
}));
jest.mock('@gitroom/helpers/utils/use.fire.events', () => ({
  useFireEvents: () => jest.fn(),
}));
jest.mock('@gitroom/frontend/components/wallet/top.up.modal', () => ({
  useIsWalletAdmin: () => true,
}));
jest.mock('@gitroom/frontend/components/wallet/wallet.hooks', () => ({
  useWalletFormat: () => ({
    number: (n: number) => String(n),
    money: (n: number) => `$${(n / 100).toFixed(2)}`,
    moneyShort: (n: number) => `$${(n / 100).toFixed(2)}`,
    credits: (n: number) => (n / 100).toFixed(2),
    dayMonthYear: () => '1 Nov 2026',
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
import { PlusPanel } from '@gitroom/frontend/components/plus/plus.panel';

const OFFER = {
  currency: 'USD',
  creditsPerPeriod: 400,
  periodDays: 30,
  topUpCreditsPerUnit: 20,
  intervals: [
    { interval: 'month', price: 1900, releases: 1, pricePerRelease: 1900, topUpPrice: 2000, savingPercent: 5 },
  ],
};
const ACCESS = { plus: false, grandfathered: false, open: false, topUpAllowed: false, frozen: false };
const planWith = (over: Record<string, any> = {}) => ({
  serverNow: new Date().toISOString(),
  paymentsEnabled: true,
  offer: OFFER,
  earlyBird: null,
  subscription: null,
  credits: { balance: 0, plan: 0, topUp: 0, planResetsAt: null },
  access: ACCESS,
  clockOffsetMs: 0,
  ...over,
});
const getPlus = () => screen.queryByRole('button', { name: /Get Plus/ });

beforeEach(() => {
  billing.mockReset();
});

describe('PlusPanel', () => {
  it('offers Plus to a free workspace', () => {
    plan = planWith();
    render(<PlusPanel />);
    expect(getPlus()).not.toBeNull();
  });

  it('offers Plus as an option to pay-as-you-go from before Plus', () => {
    plan = planWith({
      access: { ...ACCESS, legacy: true, open: true, topUpAllowed: true },
    });
    render(<PlusPanel />);
    expect(getPlus()).not.toBeNull();
    expect(screen.getByText(/on pay-as-you-go/).textContent).toContain(
      '400 credits every month'
    );
  });

  it('shows the hold notice and no Get Plus while the wallet is on hold', () => {
    plan = planWith({ access: { ...ACCESS, frozen: true } });
    render(<PlusPanel />);
    expect(screen.getByRole('status').textContent).toContain('on hold');
    expect(getPlus()).toBeNull();
  });

  it('after a failed payment, asks for the card instead of a second subscription', async () => {
    plan = planWith({
      subscription: {
        active: false,
        paymentFailed: true,
        status: 'past_due',
        interval: 'month',
        periodEnd: null,
        cancelAt: null,
        creditsPerPeriod: 400,
      },
    });
    billing.mockResolvedValue({ ok: false, status: 400, body: { message: 'x' } });
    render(<PlusPanel />);
    expect(screen.getByRole('alert').textContent).toContain(
      'Payment failed, update your card'
    );
    expect(getPlus()).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Update card/ }));
    });
    expect(billing).toHaveBeenCalledTimes(1);
  });
});
