'use client';

import { EventEmitter } from 'events';

// Opens the top-up dialog from anywhere (components, hooks or plain code such
// as a fetch handler). <WalletHost /> in the app layout listens for it.
export interface OpenTopUpOptions {
  // One line shown above the amount, e.g. why a top-up is needed.
  context?: string;
}

export const walletEvents = new EventEmitter();
walletEvents.setMaxListeners(20);

export const OPEN_TOP_UP = 'open-top-up';

export const openTopUp = (options: OpenTopUpOptions = {}) => {
  walletEvents.emit(OPEN_TOP_UP, options);
};

// Opens the Plus dialog (the offer, or the subscription when there is one).
// Locks and top-ups send people here when the workspace has no Plus.
export interface OpenPlusOptions {
  // One line shown above the offer, e.g. what was locked.
  context?: string;
}

export const OPEN_PLUS = 'open-plus';

export const openPlus = (options: OpenPlusOptions = {}) => {
  walletEvents.emit(OPEN_PLUS, options);
};
