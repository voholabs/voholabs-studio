// Shapes returned by the wallet API. Credits are integers in hundredths
// (225 = 2.25 credits); money is in the smallest unit of the wallet currency.

export type WalletBilling = 'PER_USE' | 'MONTHLY' | 'UNLOCK';
export type WalletFreePeriod = 'ONCE' | 'MONTH';
export type WalletEntryType =
  | 'TOPUP'
  | 'AUTO_TOPUP'
  | 'SPEND'
  | 'REFUND'
  | 'GRANT'
  | 'ADJUST';

export interface WalletForecastItem {
  actionKey: string;
  quantity: number;
  at: string;
  postId?: string;
}

export interface WalletSummary {
  balance: number;
  payAsYouGo: boolean;
  frozen?: boolean;
  currency: string;
  paymentsEnabled: boolean;
  topUp: {
    minAmount: number;
    options: number[];
    creditsPerUnit: number;
  } | null;
  card: { brand: string | null; last4: string } | null;
  autoTopUp: {
    enabled: boolean;
    threshold: number | null;
    amount: number | null;
    monthlyCap: number | null;
    usedThisMonth: number;
  };
  forecast?: {
    windowHours: number;
    needed: number;
    short: boolean;
    items: WalletForecastItem[];
  };
}

export interface WalletTransaction {
  id: string;
  type: WalletEntryType | string;
  description: string | null;
  amount: number;
  quantity: number | null;
  unitPrice: number | null;
  actionKey: string | null;
  reference: string | null;
  createdAt: string;
}

export interface WalletTransactions {
  total: number;
  items: WalletTransaction[];
}

export interface WalletUsage {
  byAction: {
    key: string | null;
    name: string | null;
    quantity: number;
    total: number;
  }[];
  byDay: { day: string; total: number }[];
}

export interface WalletPricedAction {
  key: string;
  provider: string | null;
  category: string | null;
  name: string;
  description: string | null;
  unit: string;
  freeUnits: number;
  freePeriod: WalletFreePeriod | null;
  billing: WalletBilling | string;
  requiresTopUp: boolean;
  price: number;
}

export interface WalletPriceSection {
  key: string;
  actions: WalletPricedAction[];
}

export interface SupportedChannel {
  identifier: string;
  name: string;
}
