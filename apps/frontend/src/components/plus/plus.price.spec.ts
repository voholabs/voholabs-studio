// Prices show the currency's decimals once there are any ("$17.10", never
// "$17.1"), and none for a whole amount ("$19"): one formatter for every
// price on the Plus page, the pricing page, the onboarding offer and the
// Plus dialog.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' } }),
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));
jest.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => undefined,
}));
jest.mock('@gitroom/frontend/components/launches/enabled.providers', () => ({
  ENABLED_PROVIDERS: [],
}));

import { renderHook } from '@testing-library/react';
import { useWalletFormat } from '@gitroom/frontend/components/wallet/wallet.hooks';

describe('moneyShort', () => {
  it('keeps two decimals once there are any, none for whole amounts', () => {
    const { result } = renderHook(() => useWalletFormat('USD'));
    const f = result.current;
    expect(f.moneyShort(1710)).toBe('$17.10');
    expect(f.moneyShort(1701)).toBe('$17.01');
    expect(f.moneyShort(1900)).toBe('$19');
    expect(f.moneyShort(17100)).toBe('$171');
    expect(f.moneyShort(15390)).toBe('$153.90');
  });

  it('follows a currency without decimals', () => {
    const { result } = renderHook(() => useWalletFormat('JPY'));
    expect(result.current.moneyShort(1710)).toBe('¥1,710');
  });
});
