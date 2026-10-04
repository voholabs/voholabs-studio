'use client';

import {
  OPEN_TOP_UP,
  openTopUp as openWalletTopUp,
  walletEvents,
} from '@gitroom/frontend/components/wallet/wallet.events';

// Opens the wallet's top-up dialog (wallet.events, listened to by
// <WalletHost />) from screens that send people to the wallet (locks,
// composer, the 402 handler). When the dialog is not mounted on this screen,
// the browser goes to the wallet page, which opens it.
export const openTopUp = (message?: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  if (walletEvents.listenerCount(OPEN_TOP_UP) > 0) {
    openWalletTopUp(message ? { context: message } : {});
    return;
  }
  window.location.href = '/wallet?topup=open';
};
