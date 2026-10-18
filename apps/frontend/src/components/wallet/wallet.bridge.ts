'use client';

import {
  OPEN_PLUS,
  OPEN_TOP_UP,
  openPlus as openWalletPlus,
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

// Opens the Plus dialog (through <WalletHost />), for everything Plus opens.
// When the dialog is not mounted on this screen, the browser goes to /plus.
export const openPlus = (message?: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  if (walletEvents.listenerCount(OPEN_PLUS) > 0) {
    openWalletPlus(message ? { context: message } : {});
    return;
  }
  window.location.href = '/plus';
};

// A wallet refusal (402 with wallet: true): `plus: true` means it needs Plus,
// anything else is a top-up.
export const openWalletRefusal = (body?: {
  message?: string;
  plus?: boolean;
}) => {
  if (body?.plus) {
    openPlus(body.message);
    return;
  }
  openTopUp(body?.message);
};

// Fetch options that hand a wallet 402 back to the caller instead of the
// global handler (which opens the top-up and never resolves the request), so
// a screen with its own spinner can stop it.
export const WALLET_INLINE_REQUEST = { walletInline: true } as RequestInit;

// For a response fetched with WALLET_INLINE_REQUEST: when it is a wallet 402,
// opens the top-up (or Plus, for `plus: true`) with its message and returns
// that message.
export const openTopUpIfWalletRefused = async (response: Response) => {
  if (response.status !== 402) {
    return undefined;
  }
  const body = await response
    .clone()
    .json()
    .catch(() => undefined);
  if (!body?.wallet) {
    return undefined;
  }
  openWalletRefusal(body);
  return (body.message as string) || '';
};
