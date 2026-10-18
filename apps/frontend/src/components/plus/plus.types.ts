// Shapes returned by the Plus API. Money is in the smallest unit of the
// currency; `units` are hundredths of a credit; creditsPerPeriod is whole
// credits.

export type PlusIntervalKey = 'month' | 'year';

export interface PlusInterval {
  interval: PlusIntervalKey;
  price: number;
  // Credit releases per payment (1 a month, one every periodDays a year).
  releases: number;
  pricePerRelease: number;
  // What the same plan credits cost as top-ups.
  topUpPrice: number;
  // How much cheaper the payment is than those top-ups, whole percent,
  // rounded down.
  savingPercent: number;
}

// GET /wallet/plus `offer`, and `plus` on GET /public/prices.
export interface PlusOffer {
  currency: string;
  creditsPerPeriod: number;
  periodDays: number;
  topUpCreditsPerUnit: number;
  intervals: PlusInterval[];
}

export interface PlusEarlyBird {
  percent: number;
  expiresAt: string;
  // The extension after the first window ran out.
  extended: boolean;
  // The workspace's personal code: applied at Checkout, it takes `percent`
  // off the first payment.
  code: string;
}

export interface PlusSubscription {
  active: boolean;
  // The payment failed and Stripe is still collecting it: the card needs
  // updating (the billing portal), not a new subscription.
  paymentFailed?: boolean;
  status: string;
  interval: PlusIntervalKey | null;
  periodEnd: string | null;
  cancelAt: string | null;
  creditsPerPeriod: number;
}

export interface PlusPlan {
  serverNow: string;
  paymentsEnabled: boolean;
  offer: PlusOffer | null;
  earlyBird: PlusEarlyBird | null;
  subscription: PlusSubscription | null;
  credits: {
    balance: number;
    plan: number;
    topUp: number;
    planResetsAt: string | null;
  };
  access: {
    plus: boolean;
    // Pay-as-you-go from before Plus: everything stays open without it.
    legacy?: boolean;
    grandfathered: boolean;
    open: boolean;
    topUpAllowed: boolean;
    // On hold after a refund or dispute: no Plus can be bought.
    frozen?: boolean;
  };
  // Added on the client when the plan is read: server clock minus this
  // browser's, so countdowns run on the server's time.
  clockOffsetMs: number;
}
