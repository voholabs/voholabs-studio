import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { createHash } from 'crypto';
import dayjs from 'dayjs';
import {
  Forecast,
  InsufficientCreditsError,
  PLUS_OPEN_STATUSES,
  PlusRequiredError,
  WalletService,
  formatCredits,
  plusPaymentFailed,
  walletFrozenMessage,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { walletAlert } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';

// Payments for the credit wallet. This uses its own Stripe keys
// (WALLET_STRIPE_*) on purpose: setting Postiz's STRIPE_* keys switches the
// whole app into Postiz billing mode, which this must never do.
//
// Every top-up is a one-off PaymentIntent (Checkout in payment mode, or an
// off-session charge to the card saved there), never an invoice. Top-ups are
// for Plus subscribers only. The Plus subscription itself is
// WalletPlusService's, on the same account.
export const walletPaymentsEnabled = () =>
  !!process.env.WALLET_STRIPE_SECRET_KEY;

const SERVICE = 'wallet';

// A Stripe payment that does not match what was created for it. The webhook
// answers non-2xx so Stripe keeps retrying and shows it as failing.
export class WalletPaymentMismatchError extends Error {}

// Card problems the customer has to fix. Anything else (Stripe down, a
// timeout, rate limits) is temporary and leaves auto top-up on.
const CARD_ERROR_CODES = [
  'card_declined',
  'expired_card',
  'incorrect_cvc',
  'incorrect_number',
  'invalid_cvc',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'insufficient_funds',
  'authentication_required',
  'payment_intent_authentication_failure',
  'payment_method_unactivated',
  'card_decline_rate_limit_exceeded',
];

const isCardError = (err: unknown) => {
  const e = err as { type?: string; code?: string };
  return (
    e?.type === 'StripeCardError' ||
    (!!e?.code && CARD_ERROR_CODES.includes(e.code))
  );
};

const isTransientError = (err: unknown) => {
  const e = err as { type?: string; statusCode?: number };
  return (
    e?.type === 'StripeAPIError' ||
    e?.type === 'StripeConnectionError' ||
    e?.type === 'StripeRateLimitError' ||
    e?.type === 'StripeIdempotencyError' ||
    (e?.statusCode || 0) >= 500
  );
};

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : value?.id;

// A saved card's expiry as stored on the wallet, "MM/YYYY".
const cardExpOf = (card?: Stripe.PaymentMethod.Card | null) =>
  card?.exp_month && card?.exp_year
    ? `${String(card.exp_month).padStart(2, '0')}/${card.exp_year}`
    : null;

// Whether a stored "MM/YYYY" expiry has passed (a card works through the
// last day of its month).
export const cardExpired = (
  exp: string | null | undefined,
  now = new Date()
) => {
  const [month, year] = (exp || '').split('/').map(Number);
  if (!month || !year) {
    return false;
  }
  return (
    year < now.getUTCFullYear() ||
    (year === now.getUTCFullYear() && month < now.getUTCMonth() + 1)
  );
};

// Why auto top-up turned itself off, kept on the wallet and shown there.
export type AutoTopUpOffReason = 'card_failed' | 'plus_ended';

const AUTO_TOP_UP_OFF_MESSAGES: Record<AutoTopUpOffReason, string> = {
  card_failed:
    'Automatic top-up is off because your saved card could not be charged. Top up your wallet or update your card, then turn it back on.',
  plus_ended:
    'Automatic top-up is off because your Plus subscription ended. Top-ups and automatic top-up come with Plus.',
};

const RECONCILE_MAX_DAYS = 90;

export interface ReconcileStripe {
  paymentIntentId: string;
  organizationId: string | null;
  amount: number;
  currency: string;
  credits: number | null;
  created: Date;
}

export interface ReconcileLedger {
  entryId: string;
  organizationId: string;
  paymentIntentId: string | null;
  type: string;
  paidAmount: number | null;
  currency: string | null;
  credits: number;
  createdAt: Date;
}

@Injectable()
export class WalletBillingService {
  private _logger = new Logger(WalletBillingService.name);
  private _client?: Stripe;

  constructor(
    private _wallet: WalletService,
    private _notifications: NotificationService
  ) {}

  // Shared with WalletPlusService, which uses the same Stripe account.
  get stripe() {
    if (!walletPaymentsEnabled()) {
      throw new Error('Wallet payments are not configured');
    }
    this._client ??= new Stripe(process.env.WALLET_STRIPE_SECRET_KEY!);
    return this._client;
  }

  async customerFor(
    organizationId: string,
    email?: string,
    name?: string
  ) {
    const wallet = await this._wallet.ensureWallet(organizationId);
    if (wallet.stripeCustomerId) {
      return wallet.stripeCustomerId;
    }
    // The key carries the parameters and the wallet's last change, so a
    // retry (or a second call at the same time) gets the same customer back,
    // while a call with other details, or one after the stored id was
    // cleared, is a new request instead of one Stripe refuses as a changed
    // repeat.
    const details = createHash('sha256')
      .update(JSON.stringify([email || null, name || null]))
      .digest('hex')
      .slice(0, 16);
    const customer = await this.stripe.customers.create(
      {
        email,
        name,
        metadata: { service: SERVICE, organizationId },
      },
      {
        idempotencyKey: `wallet-customer:${organizationId}:${wallet.updatedAt.getTime()}:${details}`,
      }
    );
    await this._wallet.updateWallet(organizationId, {
      stripeCustomerId: customer.id,
    });
    return customer.id;
  }

  // The currency a wallet pays in: the one of its first top-up, else today's
  // setting. A wallet never mixes currencies.
  async currencyFor(organizationId: string) {
    const wallet = await this._wallet.getWallet(organizationId);
    const current = await this._wallet.currency();
    if (wallet?.currency && wallet.currency.toUpperCase() !== current) {
      throw new Error(
        `This wallet is in ${wallet.currency.toUpperCase()}; top-ups are now in ${current}. Contact support.`
      );
    }
    return current;
  }

  // Checkout in setup mode: saves a new card for automatic top-ups without
  // charging it. Returns to /wallet?card=saved (with the session id) or
  // ?card=cancelled; the webhook (or the return) stores the card, and turns
  // auto top-up on when `autoTopUp` asked for it.
  async createCardSetup(params: {
    organizationId: string;
    email?: string;
    name?: string;
    autoTopUp?: boolean;
    returnUrl: string;
  }) {
    if (await this._wallet.isFrozen(params.organizationId)) {
      throw new Error(walletFrozenMessage());
    }
    if (!(await this._wallet.topUpAllowed(params.organizationId))) {
      throw new PlusRequiredError();
    }
    const currency = await this.currencyFor(params.organizationId);
    const customer = await this.customerFor(
      params.organizationId,
      params.email,
      params.name
    );
    const metadata = {
      service: SERVICE,
      kind: 'card',
      organizationId: params.organizationId,
      ...(params.autoTopUp ? { autoTopUp: '1' } : {}),
    };
    const session = await this.stripe.checkout.sessions.create({
      mode: 'setup',
      customer,
      currency: currency.toLowerCase(),
      payment_method_types: ['card'],
      setup_intent_data: { metadata },
      metadata,
      success_url: `${params.returnUrl}?card=saved&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${params.returnUrl}?card=cancelled`,
    });
    return { url: session.url };
  }

  async createCheckout(params: {
    organizationId: string;
    email?: string;
    name?: string;
    amount: number;
    saveCard: boolean;
    // Turn automatic top-up on with the saved card once paid.
    autoTopUp?: boolean;
    returnUrl: string;
  }) {
    if (await this._wallet.isFrozen(params.organizationId)) {
      throw new Error(walletFrozenMessage());
    }
    if (!(await this._wallet.topUpAllowed(params.organizationId))) {
      throw new PlusRequiredError();
    }
    const rules = await this._wallet.topUpRules();
    if (!Number.isInteger(params.amount) || params.amount < rules.minAmount) {
      throw new Error(
        `The minimum top-up is ${await this._wallet.formatMoney(
          rules.minAmount
        )}`
      );
    }
    if (!(await this._wallet.isWholeAmount(params.amount))) {
      throw new Error(await this._wallet.wholeAmountMessage());
    }

    const currency = await this.currencyFor(params.organizationId);
    const customer = await this.customerFor(
      params.organizationId,
      params.email,
      params.name
    );
    const units = await this._wallet.unitsForAmount(params.amount);
    // What this payment buys is fixed now; the webhook credits exactly this.
    const metadata = {
      service: SERVICE,
      kind: 'topup',
      organizationId: params.organizationId,
      amount: String(params.amount),
      credits: String(units),
      currency,
      ...(params.saveCard && params.autoTopUp ? { autoTopUp: '1' } : {}),
    };

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: params.amount,
            product_data: {
              name: `${(units / 100).toLocaleString('en-GB')} credits`,
              description: 'Voholabs Studio wallet top-up',
            },
          },
        },
      ],
      payment_intent_data: {
        metadata,
        setup_future_usage: params.saveCard ? 'off_session' : undefined,
      },
      custom_text: params.saveCard
        ? {
            submit: {
              message:
                'Your card will be saved for automatic top-ups. We only charge it when your balance runs low, up to the monthly limit you set, and you can turn this off at any time.',
            },
          }
        : undefined,
      metadata,
      success_url: `${params.returnUrl}?topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${params.returnUrl}?topup=cancelled`,
    });
    return { url: session.url };
  }

  // The browser came back from Checkout: credit the session now if it is
  // paid, through the same idempotent path as the webhook. Returns false when
  // the session is not this workspace's.
  async confirmCheckout(organizationId: string, sessionId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    if (
      session.metadata?.service !== SERVICE ||
      session.metadata.organizationId !== organizationId
    ) {
      return false;
    }
    await this.checkoutPaid(session);
    return true;
  }

  validateWebhook(rawBody: Buffer, signature: string) {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.WALLET_STRIPE_WEBHOOK_SECRET!
    );
  }

  async handleEvent(event: Stripe.Event) {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return this.checkoutPaid(event.data.object as Stripe.Checkout.Session);
      case 'payment_intent.succeeded':
        return this.autoTopUpPaid(event.data.object as Stripe.PaymentIntent);
      case 'payment_intent.payment_failed':
        return this.autoTopUpFailed(event.data.object as Stripe.PaymentIntent);
      case 'charge.refunded':
        return this.chargeRefunded(event.data.object as Stripe.Charge);
      case 'charge.dispute.created':
        return this.chargeDisputed(event.data.object as Stripe.Dispute);
    }
    return { ok: true };
  }

  // Checks a payment against the metadata written when it was created, and
  // returns what to credit. Throws WalletPaymentMismatchError (and alerts)
  // when they disagree.
  private async verified(
    id: string,
    metadata: Stripe.Metadata,
    paid: { amount: number | null; currency: string | null }
  ) {
    const organizationId = metadata.organizationId;
    const amount = Number(metadata.amount);
    const credits = Number(metadata.credits);
    const currency = (metadata.currency || '').toUpperCase();
    if (
      !organizationId ||
      !Number.isInteger(amount) ||
      amount <= 0 ||
      !Number.isInteger(credits) ||
      credits <= 0 ||
      !currency ||
      paid.amount !== amount ||
      (paid.currency || '').toUpperCase() !== currency
    ) {
      const message = `Payment ${id} does not match its metadata (org ${organizationId}, metadata ${amount} ${currency} for ${credits} units, paid ${paid.amount} ${paid.currency}). Nothing was credited.`;
      await walletAlert(message);
      throw new WalletPaymentMismatchError(message);
    }
    return { organizationId, amount, credits, currency };
  }

  private async checkoutPaid(session: Stripe.Checkout.Session) {
    // A Plus subscription checkout is WalletPlusService's.
    if (session.mode === 'subscription' || session.metadata?.kind === 'plus') {
      return { ok: true };
    }
    if (session.metadata?.service === SERVICE && session.mode === 'setup') {
      return this.cardSetUp(session);
    }
    if (
      session.metadata?.service !== SERVICE ||
      session.payment_status !== 'paid'
    ) {
      return { ok: true };
    }
    const paymentIntentId = idOf(session.payment_intent);
    const paid = await this.verified(session.id, session.metadata, {
      amount: session.amount_subtotal,
      currency: session.currency,
    });
    if (!paymentIntentId) {
      await walletAlert(`Checkout ${session.id} is paid but has no payment.`);
      throw new WalletPaymentMismatchError(
        `Checkout ${session.id} has no payment intent`
      );
    }

    // Credits come from the metadata above; the payment is only read for its
    // receipt and saved card, and never blocks the credit.
    const intent = await this.stripe.paymentIntents
      .retrieve(paymentIntentId, {
        expand: ['payment_method', 'latest_charge'],
      })
      .catch((err) => {
        this._logger.error(
          `Could not read payment ${paymentIntentId} for its receipt: ${err}`
        );
        return undefined;
      });
    await this._wallet.addTopUp({
      ...paid,
      auto: false,
      paymentIntentId,
      receiptUrl: intent ? await this.receiptUrl(intent) : null,
    });
    if (intent) {
      const saved = await this.rememberCard(paid.organizationId, intent);
      if (saved && session.metadata?.autoTopUp === '1') {
        await this.enableAutoTopUpFromWebhook(paid.organizationId);
      }
    }
    this.notifyIfShort(paid.organizationId).catch(() => undefined);
    return { ok: true };
  }

  // Stripe's receipt link for a payment, or null if it can't be read.
  private async receiptUrl(intent: Stripe.PaymentIntent) {
    try {
      const charge =
        typeof intent.latest_charge === 'string'
          ? await this.stripe.charges.retrieve(intent.latest_charge)
          : intent.latest_charge;
      return charge?.receipt_url || null;
    } catch (err) {
      this._logger.error(`Could not read the receipt of ${intent.id}: ${err}`);
      return null;
    }
  }

  // Keeps the card saved during checkout, if the customer agreed to save it.
  private async rememberCard(
    organizationId: string,
    intent: Stripe.PaymentIntent
  ) {
    const method = intent.payment_method as Stripe.PaymentMethod | null;
    if (!intent.setup_future_usage || !method?.id) {
      return false;
    }
    await this.storeCard(organizationId, method);
    await this.cardForPlus(organizationId, method.id);
    return true;
  }

  // Keeps a payment method as the wallet's card, the one auto top-up
  // charges.
  async storeCard(organizationId: string, method: Stripe.PaymentMethod) {
    await this._wallet.updateWallet(organizationId, {
      paymentMethodId: method.id,
      cardBrand: method.card?.brand || null,
      cardLast4: method.card?.last4 || null,
      cardExp: cardExpOf(method.card),
    });
  }

  // A card saved in the wallet (a top-up or the card setup) also pays for
  // Plus from now on: it becomes the subscription's default payment method
  // and the customer's, so a renewal and an auto top-up use the same card.
  // Nothing to do without a Plus subscription that has not ended, or when it
  // already pays with this card. Never throws: a failure is alerted, and the
  // subscription keeps its card.
  async cardForPlus(organizationId: string, paymentMethodId: string) {
    try {
      const wallet = await this._wallet.getWallet(organizationId);
      if (
        !wallet?.plusSubscriptionId ||
        !wallet.stripeCustomerId ||
        !PLUS_OPEN_STATUSES.includes(wallet.plusStatus || '') ||
        wallet.plusPaymentMethodId === paymentMethodId
      ) {
        return;
      }
      await this.stripe.subscriptions.update(wallet.plusSubscriptionId, {
        default_payment_method: paymentMethodId,
      });
      await this.stripe.customers.update(wallet.stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      // Recorded last: Stripe's own events about these updates may come
      // first and push the same card once more, which changes nothing.
      await this._wallet.updateWallet(organizationId, {
        plusPaymentMethodId: paymentMethodId,
      });
    } catch (err) {
      await walletAlert(
        `The wallet card ${paymentMethodId} of org ${organizationId} could not be made the card of its Plus subscription, which keeps its own card: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  // The top-up dialog's "auto top-up" choice, applied once the card is
  // saved: on, with the wallet's own settings if it has them, else the
  // defaults from the billing settings (the first amount and limit
  // offered). The limit is never below one top-up. Once per payment: the
  // webhook and the browser's return both land here, and a wallet that
  // already has it on is left alone.
  async enableAutoTopUpDefaults(organizationId: string) {
    const wallet = await this._wallet.getWallet(organizationId);
    if (
      !wallet ||
      wallet.autoTopUp ||
      wallet.frozenAt ||
      !wallet.paymentMethodId
    ) {
      return false;
    }
    const rules = await this._wallet.topUpRules();
    const amount =
      wallet.autoTopUpAmount || rules.autoOptions[0] || rules.minAmount;
    const cap = Math.max(
      wallet.autoTopUpMonthlyCap || rules.capOptions[0] || amount,
      amount
    );
    await this._wallet.updateWallet(organizationId, {
      autoTopUp: true,
      autoTopUpAmount: amount,
      autoTopUpMonthlyCap: cap,
      autoTopUpThreshold:
        wallet.autoTopUpThreshold ?? rules.defaultThreshold ?? null,
      autoTopUpOffReason: null,
      autoTopUpOffAt: null,
    });
    return true;
  }

  // The same from a webhook, which must not fail once the card is saved: a
  // failure is alerted and auto top-up stays as it was.
  private async enableAutoTopUpFromWebhook(organizationId: string) {
    try {
      await this.enableAutoTopUpDefaults(organizationId);
    } catch (err) {
      await walletAlert(
        `Auto top-up could not be turned on for org ${organizationId} after its card was saved: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  // A setup-mode Checkout finished: the new card replaces the saved one.
  private async cardSetUp(session: Stripe.Checkout.Session) {
    const organizationId = session.metadata?.organizationId;
    const setupIntentId = idOf(session.setup_intent);
    if (session.status !== 'complete' || !organizationId || !setupIntentId) {
      return { ok: true };
    }
    const wallet = await this._wallet.getWallet(organizationId);
    const customer = idOf(session.customer);
    if (!wallet?.stripeCustomerId || wallet.stripeCustomerId !== customer) {
      await walletAlert(
        `Card setup ${session.id} for org ${organizationId} does not match its wallet's Stripe customer. No card was saved.`
      );
      return { ok: true };
    }
    const intent = await this.stripe.setupIntents.retrieve(setupIntentId, {
      expand: ['payment_method'],
    });
    const method = intent.payment_method as Stripe.PaymentMethod | null;
    if (intent.status !== 'succeeded' || !method?.id) {
      return { ok: true };
    }
    await this.storeCard(organizationId, method);
    await this.cardForPlus(organizationId, method.id);
    if (session.metadata?.autoTopUp === '1') {
      await this.enableAutoTopUpFromWebhook(organizationId);
    }
    return { ok: true };
  }

  private async autoTopUpPaid(intent: Stripe.PaymentIntent) {
    if (
      intent.metadata?.service !== SERVICE ||
      intent.metadata.kind !== 'auto_topup'
    ) {
      return { ok: true };
    }
    const paid = await this.verified(intent.id, intent.metadata, {
      amount: intent.amount_received || intent.amount,
      currency: intent.currency,
    });
    await this._wallet.addTopUp({
      ...paid,
      auto: true,
      paymentIntentId: intent.id,
      receiptUrl: await this.receiptUrl(intent),
    });
    return { ok: true };
  }

  private async autoTopUpFailed(intent: Stripe.PaymentIntent) {
    if (
      intent.metadata?.service !== SERVICE ||
      intent.metadata.kind !== 'auto_topup'
    ) {
      return { ok: true };
    }
    await this.disableAutoTopUp(
      intent.metadata.organizationId,
      intent.last_payment_error?.code ||
        intent.last_payment_error?.message ||
        'the payment failed',
      'card_failed'
    );
    return { ok: true };
  }

  // A refund or dispute can arrive before the event that credits its
  // payment (a dispute can be opened the moment a card is charged). Credits
  // the payment first, through the same idempotent path, when it is a paid
  // wallet top-up not in the ledger yet, so the claw-back always has
  // something to take back.
  private async creditBeforeClawBack(paymentIntentId: string) {
    const intent = await this.stripe.paymentIntents
      .retrieve(paymentIntentId)
      .catch(() => undefined);
    if (
      !intent ||
      intent.status !== 'succeeded' ||
      intent.metadata?.service !== SERVICE ||
      (intent.metadata.kind !== 'topup' &&
        intent.metadata.kind !== 'auto_topup')
    ) {
      return;
    }
    const paid = await this.verified(intent.id, intent.metadata, {
      amount: intent.amount_received || intent.amount,
      currency: intent.currency,
    });
    await this._wallet.addTopUp({
      ...paid,
      auto: intent.metadata.kind === 'auto_topup',
      paymentIntentId: intent.id,
      receiptUrl: await this.receiptUrl(intent),
    });
  }

  // Claws back a payment's credits, crediting the payment first if its own
  // event has not been handled yet.
  private async clawBackPayment(
    params: Parameters<WalletService['clawBack']>[0]
  ) {
    const result = await this._wallet.clawBack(params);
    if (result) {
      return result;
    }
    await this.creditBeforeClawBack(params.paymentIntentId);
    return this._wallet.clawBack(params);
  }

  // A refund of a wallet payment takes the same share of its credits back
  // (allowed below zero), and freezes the wallet.
  private async chargeRefunded(charge: Stripe.Charge) {
    const paymentIntentId = idOf(charge.payment_intent);
    if (!paymentIntentId || !charge.amount) {
      return { ok: true };
    }
    const result = await this.clawBackPayment({
      paymentIntentId,
      share: charge.amount_refunded / charge.amount,
      eventKey: `refund:${charge.amount_refunded}`,
      description: 'Payment refunded',
    });
    if (!result) {
      if (
        await this.plusChargeBack(
          paymentIntentId,
          `refunded (${charge.amount_refunded}/${
            charge.amount
          } ${charge.currency.toUpperCase()})`,
          'Plus payment refunded: plan credits taken back'
        )
      ) {
        return { ok: true };
      }
      if (charge.metadata?.service === SERVICE) {
        await walletAlert(
          `Refund on wallet payment ${paymentIntentId}, which never credited a wallet.`
        );
      }
      return { ok: true };
    }
    await walletAlert(
      `Payment ${paymentIntentId} refunded (${charge.amount_refunded}/${
        charge.amount
      } ${charge.currency.toUpperCase()}): took back ${formatCredits(
        result.credits
      )} credits from org ${result.organizationId} and froze its wallet.`
    );
    return { ok: true };
  }

  // A dispute takes back all of that payment's credits and freezes the
  // wallet until support clears it.
  private async chargeDisputed(dispute: Stripe.Dispute) {
    const paymentIntentId = idOf(dispute.payment_intent);
    if (!paymentIntentId) {
      return { ok: true };
    }
    const result = await this.clawBackPayment({
      paymentIntentId,
      share: 1,
      eventKey: `dispute:${dispute.id}`,
      description: 'Payment disputed',
    });
    if (!result) {
      await this.plusChargeBack(
        paymentIntentId,
        `disputed (${dispute.id}, ${dispute.reason})`,
        'Plus payment disputed: plan credits taken back'
      );
      return { ok: true };
    }
    await walletAlert(
      `Payment ${paymentIntentId} disputed (${dispute.id}, ${
        dispute.reason
      }): took back ${formatCredits(result.credits)} credits from org ${
        result.organizationId
      } and froze its wallet.`
    );
    return { ok: true };
  }

  // The Plus subscription a payment paid an invoice of (from the invoice's
  // subscription metadata), or undefined when it is not a Plus payment.
  private async plusInvoiceOf(paymentIntentId: string) {
    const payments = await this.stripe.invoicePayments.list({
      payment: { type: 'payment_intent', payment_intent: paymentIntentId },
      expand: ['data.invoice'],
      limit: 1,
    });
    const found = payments.data[0]?.invoice;
    const invoice =
      found && typeof found !== 'string' && !('deleted' in found && found.deleted)
        ? (found as Stripe.Invoice)
        : undefined;
    const details = invoice?.parent?.subscription_details;
    const subscriptionId = idOf(details?.subscription);
    if (
      !details ||
      !subscriptionId ||
      details.metadata?.service !== SERVICE ||
      details.metadata?.kind !== 'plus' ||
      !details.metadata.organizationId
    ) {
      return undefined;
    }
    return {
      organizationId: details.metadata.organizationId,
      subscriptionId,
      customerId: idOf(invoice?.customer),
    };
  }

  // A refund or dispute of a Plus payment ends Plus at once: the wallet is
  // frozen as for a top-up, what is left of the plan credits is taken back,
  // and the subscription is cancelled in Stripe now, not at the period's
  // end. Each step runs even when another fails; failures are logged and
  // alerted, never thrown. Returns whether the payment was a Plus one.
  private async plusChargeBack(
    paymentIntentId: string,
    what: string,
    description: string
  ) {
    let plus: Awaited<ReturnType<WalletBillingService['plusInvoiceOf']>>;
    try {
      plus = await this.plusInvoiceOf(paymentIntentId);
    } catch (err) {
      await this.chargeBackFailed(
        `Payment ${paymentIntentId} ${what}: could not tell whether it paid for Plus, so nothing was done. Check it in Stripe`,
        err
      );
      return false;
    }
    if (!plus) {
      return false;
    }
    const { organizationId, subscriptionId } = plus;
    let wallet: Awaited<ReturnType<WalletService['getWallet']>>;
    try {
      wallet = await this._wallet.getWallet(organizationId);
    } catch (err) {
      await this.chargeBackFailed(
        `Plus payment ${paymentIntentId} ${what}: org ${organizationId}'s wallet could not be read, so nothing was done. Check it in Stripe`,
        err
      );
      return true;
    }
    if (!wallet?.stripeCustomerId || wallet.stripeCustomerId !== plus.customerId) {
      await walletAlert(
        `Plus payment ${paymentIntentId} ${what} (subscription ${subscriptionId}, org ${organizationId}) does not match its wallet's Stripe customer. Nothing was done.`
      );
      return true;
    }
    // A payment of an earlier subscription than the one on record: the
    // current one and its credits are left alone, for a person to decide.
    // One not recorded yet (the dispute came before its checkout events),
    // or after a recorded one that ended, is handled as this payment's: it
    // is cancelled and the wallet frozen, so its later events record it as
    // ended and Plus never opens.
    if (
      wallet.plusSubscriptionId &&
      wallet.plusSubscriptionId !== subscriptionId &&
      PLUS_OPEN_STATUSES.includes(wallet.plusStatus || '')
    ) {
      await walletAlert(
        `Plus payment ${paymentIntentId} ${what} belongs to subscription ${subscriptionId}, not org ${organizationId}'s current ${wallet.plusSubscriptionId}. Nothing was done; check both in Stripe.`
      );
      return true;
    }
    const done: string[] = [];
    try {
      if (await this._wallet.freeze(organizationId)) {
        done.push('froze its wallet');
      }
    } catch (err) {
      await this.chargeBackFailed(
        `Plus payment ${paymentIntentId} ${what}: org ${organizationId}'s wallet could not be frozen`,
        err
      );
    }
    try {
      const taken = await this._wallet.takeBackPlanCredits(
        organizationId,
        subscriptionId,
        description
      );
      if (taken > 0) {
        done.push(`took back ${formatCredits(taken)} plan credits`);
      }
    } catch (err) {
      await this.chargeBackFailed(
        `Plus payment ${paymentIntentId} ${what}: org ${organizationId}'s plan credits could not be taken back`,
        err
      );
    }
    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId
      );
      if (subscription.status !== 'canceled') {
        await this.stripe.subscriptions.cancel(subscriptionId);
        done.push(`cancelled subscription ${subscriptionId}`);
      }
    } catch (err) {
      await this.chargeBackFailed(
        `Plus payment ${paymentIntentId} ${what}: subscription ${subscriptionId} (org ${organizationId}) could not be cancelled. Cancel it in Stripe`,
        err
      );
    }
    if (done.length) {
      await walletAlert(
        `Plus payment ${paymentIntentId} ${what}: ${done.join(
          ', '
        )} for org ${organizationId}.`
      );
    }
    return true;
  }

  private chargeBackFailed(message: string, err: unknown) {
    return walletAlert(
      `${message}: ${err instanceof Error ? err.message : err}`
    );
  }

  // Turns auto top-up off by itself (a card problem, or Plus ended), keeps
  // why for the wallet page, tells the workspace in the app, and alerts.
  // Does nothing if it was already off.
  async disableAutoTopUp(
    organizationId: string,
    reason: string,
    offReason: AutoTopUpOffReason
  ) {
    const wallet = await this._wallet.getWallet(organizationId);
    if (!wallet?.autoTopUp) {
      return;
    }
    await this._wallet.updateWallet(organizationId, {
      autoTopUp: false,
      autoTopUpOffReason: offReason,
      autoTopUpOffAt: new Date(),
    });
    try {
      await this._notifications.inAppNotification(
        organizationId,
        'Automatic top-up turned off',
        AUTO_TOP_UP_OFF_MESSAGES[offReason],
        false,
        false,
        'fail'
      );
    } catch (err) {
      this._logger.error(
        `Could not notify ${organizationId} that auto top-up is off: ${err}`
      );
    }
    await walletAlert(
      `Auto top-up turned off for org ${organizationId}: ${reason}`
    );
  }

  // Tops up from the saved card when auto top-up is on, the balance is under
  // the threshold (or short of `needed`), and the month's limit allows it.
  // Returns true if credits were added. `partial` tops up even when one
  // top-up alone does not reach `needed` (autoTopUpFor adds several).
  async autoTopUp(organizationId: string, needed = 0, partial = false) {
    if (!walletPaymentsEnabled()) {
      return false;
    }
    const wallet = await this._wallet.getWallet(organizationId);
    if (
      !wallet?.autoTopUp ||
      wallet.frozenAt ||
      !wallet.paymentMethodId ||
      !wallet.stripeCustomerId ||
      !wallet.autoTopUpAmount
    ) {
      return false;
    }
    // Top-ups need Plus (or pay-as-you-go from before Plus): auto top-up
    // rests while neither is on, and while a Plus payment is failing (that
    // card is not charged again here).
    if (
      plusPaymentFailed(wallet) ||
      !(await this._wallet.walletTopUpAllowed(wallet))
    ) {
      return false;
    }

    // The trigger is the whole balance, plan and top-up credits together:
    // plan credits are spent first, so they count while their period runs.
    // Periods that ended are expired first, so credits that are gone never
    // hold a top-up back.
    await this._wallet.syncPlan(organizationId);
    const balance = await this._wallet.balance(organizationId);
    const threshold = wallet.autoTopUpThreshold || 0;
    if (balance >= threshold && balance >= needed) {
      return false;
    }

    const amount = wallet.autoTopUpAmount;
    const spent = await this._wallet.autoTopUpSpentSince(
      organizationId,
      dayjs().startOf('month').toDate()
    );
    if (
      wallet.autoTopUpMonthlyCap &&
      spent + amount > wallet.autoTopUpMonthlyCap
    ) {
      return false;
    }
    const credits = await this._wallet.unitsForAmount(amount);
    if (!partial && balance + credits < needed) {
      return false;
    }

    let currency: string;
    try {
      currency = await this.currencyFor(organizationId);
    } catch (err) {
      await walletAlert(
        `Auto top-up skipped for org ${organizationId}: ${
          (err as Error).message
        }`
      );
      return false;
    }

    const metadata = {
      service: SERVICE,
      kind: 'auto_topup',
      organizationId,
      amount: String(amount),
      credits: String(credits),
      currency,
    };

    try {
      // One attempt per top-up, however many posts ask for it at once: the
      // key holds the card and what auto top-up has added this month, so it
      // changes once a top-up is credited (the next one is a new payment, not
      // a replay of the last) and when the card changes. The ten-minute part
      // lets a failed attempt be tried again later.
      const intent = await this.stripe.paymentIntents.create(
        {
          amount,
          currency: currency.toLowerCase(),
          customer: wallet.stripeCustomerId,
          payment_method: wallet.paymentMethodId,
          off_session: true,
          confirm: true,
          description: 'Voholabs Studio automatic top-up',
          metadata,
        },
        {
          idempotencyKey: `wallet-auto:${organizationId}:${
            wallet.paymentMethodId
          }:${amount}:${spent}:${Math.floor(Date.now() / 600_000)}`,
        }
      );

      if (intent.status === 'requires_action') {
        await this.disableAutoTopUp(
          organizationId,
          'the card needs the customer to authenticate',
          'card_failed'
        );
        return false;
      }
      if (intent.status !== 'succeeded') {
        return false;
      }
      await this.autoTopUpPaid(intent);
      return true;
    } catch (err) {
      if (isCardError(err)) {
        await this.disableAutoTopUp(
          organizationId,
          (err as { code?: string }).code || (err as Error).message,
          'card_failed'
        );
      } else if (isTransientError(err)) {
        this._logger.error(
          `Auto top-up for ${organizationId} hit a temporary Stripe error, auto top-up stays on: ${err}`
        );
      } else {
        await walletAlert(
          `Auto top-up for org ${organizationId} failed (auto top-up stays on): ${
            (err as Error).message
          }`
        );
      }
      return false;
    }
  }

  // Tops up as many times as it takes for the balance to reach `needed`, but
  // only when auto top-up can cover all of it within this month's limit
  // (a card is never charged for a top-up that would not be enough). Returns
  // whether the balance now covers `needed`.
  async autoTopUpFor(organizationId: string, needed: number) {
    let balance = await this._wallet.balance(organizationId);
    if (balance >= needed) {
      return true;
    }
    const room = await this._wallet.autoTopUpRoom(organizationId);
    if (
      !room.perTopUp ||
      Math.ceil((needed - balance) / room.perTopUp) > room.topUps
    ) {
      return false;
    }
    for (let i = 0; i < 20 && balance < needed; i++) {
      if (!(await this.autoTopUp(organizationId, needed, true))) {
        break;
      }
      balance = await this._wallet.balance(organizationId);
    }
    return balance >= needed;
  }

  // Charges an action, topping up first if auto top-up can cover it.
  charge(params: Parameters<WalletService['charge']>[0]) {
    return this.withAutoTopUp(params.organizationId, () =>
      this._wallet.charge(params)
    );
  }

  // Charges the items not already charged under the prefix (see
  // WalletService.chargeItems), topping up first like `charge`.
  chargeItems(params: Parameters<WalletService['chargeItems']>[0]) {
    return this.withAutoTopUp(params.organizationId, () =>
      this._wallet.chargeItems(params)
    );
  }

  private async withAutoTopUp<T>(
    organizationId: string,
    run: () => Promise<T>
  ) {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof InsufficientCreditsError)) {
        throw err;
      }
      if (!(await this.autoTopUp(organizationId, err.needed))) {
        throw err;
      }
      return run();
    } finally {
      // Keep the balance above the threshold for the next one, then check
      // whether what is scheduled next can still be paid for.
      this.autoTopUp(organizationId)
        .catch(() => false)
        .then(() => this.notifyIfShort(organizationId))
        .catch(() => undefined);
    }
  }

  // See WalletService.notifyIfShort.
  notifyIfShort(organizationId: string, forecast?: Forecast) {
    return this._wallet.notifyIfShort(organizationId, forecast);
  }

  // Compares wallet payments in Stripe (PaymentIntents with metadata
  // service=wallet that succeeded) with the top-ups in the ledger over the
  // last `days` days. stripeOnly: paid but never credited. ledgerOnly:
  // credited with no matching successful payment. mismatched: both exist
  // but the workspace, amount, currency or credits differ.
  async reconcile(days = 7) {
    const span = Math.min(
      Math.max(Math.floor(days) || 7, 1),
      RECONCILE_MAX_DAYS
    );
    const since = new Date(Date.now() - span * 86_400_000);

    const intents = new Map<string, Stripe.PaymentIntent>();
    for await (const intent of this.stripe.paymentIntents.list({
      created: { gte: Math.floor(since.getTime() / 1000) },
      limit: 100,
    })) {
      if (
        intent.metadata?.service === SERVICE &&
        intent.status === 'succeeded'
      ) {
        intents.set(intent.id, intent);
      }
    }

    const recent = await this._wallet.topUpsSince(since);
    const byPayment = new Map(
      recent.filter((e) => e.reference).map((e) => [e.reference!, e])
    );
    // Payments made in the window but credited before it would not be in
    // `recent`; look those up by key.
    const missing = [...intents.keys()].filter((id) => !byPayment.has(id));
    for (const entry of await this._wallet.topUpEntries(missing)) {
      if (entry.reference) {
        byPayment.set(entry.reference, entry);
      }
    }

    const stripeView = (intent: Stripe.PaymentIntent): ReconcileStripe => ({
      paymentIntentId: intent.id,
      organizationId: intent.metadata?.organizationId || null,
      amount: intent.amount_received || intent.amount,
      currency: intent.currency.toUpperCase(),
      credits: Number.isInteger(Number(intent.metadata?.credits))
        ? Number(intent.metadata.credits)
        : null,
      created: new Date(intent.created * 1000),
    });
    const ledgerView = (
      entry: Awaited<ReturnType<WalletService['topUpsSince']>>[number]
    ): ReconcileLedger => ({
      entryId: entry.id,
      organizationId: entry.organizationId,
      paymentIntentId: entry.reference,
      type: entry.type,
      paidAmount: entry.paidAmount,
      currency: entry.currency,
      credits: entry.amount,
      createdAt: entry.createdAt,
    });

    const stripeOnly: ReconcileStripe[] = [];
    const mismatched: { stripe: ReconcileStripe; ledger: ReconcileLedger }[] =
      [];
    for (const intent of intents.values()) {
      const entry = byPayment.get(intent.id);
      if (!entry) {
        stripeOnly.push(stripeView(intent));
        continue;
      }
      const stripe = stripeView(intent);
      if (
        stripe.organizationId !== entry.organizationId ||
        stripe.amount !== entry.paidAmount ||
        stripe.currency !== (entry.currency || '').toUpperCase() ||
        stripe.credits !== entry.amount
      ) {
        mismatched.push({ stripe, ledger: ledgerView(entry) });
      }
    }

    // Ledger top-ups whose payment was not among the window's successful
    // wallet payments: check each one directly before calling it unmatched.
    const ledgerOnly: ReconcileLedger[] = [];
    for (const entry of recent) {
      if (entry.reference && intents.has(entry.reference)) {
        continue;
      }
      const intent = entry.reference
        ? await this.stripe.paymentIntents
            .retrieve(entry.reference)
            .catch(() => undefined)
        : undefined;
      if (
        !intent ||
        intent.status !== 'succeeded' ||
        intent.metadata?.service !== SERVICE
      ) {
        ledgerOnly.push(ledgerView(entry));
        continue;
      }
      const stripe = stripeView(intent);
      if (
        stripe.organizationId !== entry.organizationId ||
        stripe.amount !== entry.paidAmount ||
        stripe.currency !== (entry.currency || '').toUpperCase() ||
        stripe.credits !== entry.amount
      ) {
        mismatched.push({ stripe, ledger: ledgerView(entry) });
      }
    }

    return { days: span, since, stripeOnly, ledgerOnly, mismatched };
  }
}
