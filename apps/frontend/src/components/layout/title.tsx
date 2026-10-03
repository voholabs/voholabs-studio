'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { useMenuItem } from '@gitroom/frontend/components/layout/top.menu';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export const Title = () => {
  const path = usePathname();
  const { all: menuItems } = useMenuItem();
  const t = useT();
  const currentTitle = useMemo(() => {
    return (
      menuItems.find((item) => path.indexOf(item.path) > -1)?.name ||
      // Wallet pages are reached from the wallet in the top bar, not the menu.
      (path.startsWith('/wallet/prices')
        ? t('wallet_prices_title', 'Prices')
        : path.startsWith('/wallet')
        ? t('wallet_billing_title', 'Billing')
        : undefined)
    );
  }, [path]);

  return <h1>{currentTitle}</h1>;
};
