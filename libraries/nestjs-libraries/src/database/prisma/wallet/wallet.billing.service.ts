import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import dayjs from 'dayjs';
import {
  Forecast,
  InsufficientCreditsError,
  WalletService,
  formatCredits,
  walletFrozenMessage,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { walletAlert } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';

// Payments for the credit wallet. This uses its own Stripe keys
// (WALLET_STRIPE_*) on purpose: setting Postiz's STRIPE_* keys switches the
// whole app into Postiz billing mode, which this must never do.
//
// Every payment is a one-off PaymentIntent (Checkout in payment mode, or an
// off-session charge to the card saved there), never an invoice or a
// subscription.
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

const paymentIntentIdOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : value?.id;

// A saved card's expiry as stored on the wallet, "MM/YYYY".
const cardExpOf = (card?: Stripe.PaymentMethod.Card | null) =>
  card?.exp_month && card?.exp_year
    ? `${String(card.exp_month).padStart(2, '0')}/${card.exp_year}`
    : null;

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

  private get stripe() {
    if (!walletPaymentsEnabled()) {
      throw new Error('Wallet payments are not configured');
    }
    this._client ??= new Stripe(process.env.WALLET_STRIPE_SECRET_KEY!);
    return this._client;
  }

  private async customerFor(
    organizationId: string,
    email?: string,
    name?: string
  ) {
    const wallet = await this._wallet.ensureWallet(organizationId);
    if (wallet.stripeCustomerId) {
      return wallet.stripeCustomerId;
    }
    const customer = await this.stripe.customers.create(
      {
        email,
        name,
        metadata: { service: SERVICE, organizationId },
      },
      { idempotencyKey: `wallet-customer:${organizationId}` }
    );
    await this._wallet.updateWallet(organizationId, {
      stripeCustomerId: customer.id,
    });
    return customer.id;
  }

  // The currency a wallet pays in: the one of its first top-up, else today's
  // setting. A wallet never mixes currencies.
  private async currencyFor(organizationId: string) {
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
  // ?card=cancelled; the webhook (or the return) stores the card.
  async createCardSetup(params: {
    organizationId: string;
    email?: string;
    name?: string;
    returnUrl: string;
  }) {
    if (await this._wallet.isFrozen(params.organizationId)) {
      throw new Error(walletFrozenMessage());
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
    returnUrl: string;
  }) {
    if (await this._wallet.isFrozen(params.organizationId)) {
      throw new Error(walletFrozenMessage());
    }
    const rules = await this._wallet.topUpRules();
    if (!Number.isInteger(params.amount) || params.amount < rules.minAmount) {
      throw new Error(
        `The minimum top-up is ${await this._wallet.formatMoney(
          rules.minAmount
        )}`
      );
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
    if (session.metadata?.service === SERVICE && session.mode === 'setup') {
      return this.cardSetUp(session);
    }
    if (
      session.metadata?.service !== SERVICE ||
      session.payment_status !== 'paid'
    ) {
      return { ok: true };
    }
    const paymentIntentId = paymentIntentIdOf(session.payment_intent);
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
      await this.rememberCard(paid.organizationId, intent);
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
      return;
    }
    await this._wallet.updateWallet(organizationId, {
      paymentMethodId: method.id,
      cardBrand: method.card?.brand || null,
      cardLast4: method.card?.last4 || null,
      cardExp: cardExpOf(method.card),
    });
  }

  // A setup-mode Checkout finished: the new card replaces the saved one.
  private async cardSetUp(session: Stripe.Checkout.Session) {
    const organizationId = session.metadata?.organizationId;
    const setupIntentId = paymentIntentIdOf(session.setup_intent);
    if (session.status !== 'complete' || !organizationId || !setupIntentId) {
      return { ok: true };
    }
    const wallet = await this._wallet.getWallet(organizationId);
    const customer = paymentIntentIdOf(session.customer);
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
    await this._wallet.updateWallet(organizationId, {
      paymentMethodId: method.id,
      cardBrand: method.card?.brand || null,
      cardLast4: method.card?.last4 || null,
      cardExp: cardExpOf(method.card),
    });
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
        'the payment failed'
    );
    return { ok: true };
  }

  // A refund of a wallet payment takes the same share of its credits back
  // (allowed below zero), and freezes the wallet.
  private async chargeRefunded(charge: Stripe.Charge) {
    const paymentIntentId = paymentIntentIdOf(charge.payment_intent);
    if (!paymentIntentId || !charge.amount) {
      return { ok: true };
    }
    const result = await this._wallet.clawBack({
      paymentIntentId,
      share: charge.amount_refunded / charge.amount,
      eventKey: `refund:${charge.amount_refunded}`,
      description: 'Payment refunded',
    });
    if (!result) {
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
    const paymentIntentId = paymentIntentIdOf(dispute.payment_intent);
    if (!paymentIntentId) {
      return { ok: true };
    }
    const result = await this._wallet.clawBack({
      paymentIntentId,
      share: 1,
      eventKey: `dispute:${dispute.id}`,
      description: 'Payment disputed',
    });
    if (!result) {
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

  // Turns auto top-up off after a card problem, tells the workspace in the
  // app, and alerts. Does nothing if it was already off.
  private async disableAutoTopUp(organizationId: string, reason: string) {
    const wallet = await this._wallet.getWallet(organizationId);
    if (!wallet?.autoTopUp) {
      return;
    }
    await this._wallet.updateWallet(organizationId, { autoTopUp: false });
    try {
      await this._notifications.inAppNotification(
        organizationId,
        'Automatic top-up turned off',
        'Automatic top-up is off because your saved card could not be charged. Top up your wallet or update your card, then turn it back on.',
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
  // Returns true if credits were added.
  async autoTopUp(organizationId: string, needed = 0) {
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
    if (balance + credits < needed) {
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
      // One attempt per wallet and amount per ten minutes, however many posts
      // ask for it.
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
          idempotencyKey: `wallet-auto:${organizationId}:${amount}:${Math.floor(
            Date.now() / 600_000
          )}`,
        }
      );

      if (intent.status === 'requires_action') {
        await this.disableAutoTopUp(
          organizationId,
          'the card needs the customer to authenticate'
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
          (err as { code?: string }).code || (err as Error).message
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

  // Charges an action, topping up first if auto top-up can cover it.
  async charge(params: Parameters<WalletService['charge']>[0]) {
    try {
      return await this._wallet.charge(params);
    } catch (err) {
      if (!(err instanceof InsufficientCreditsError)) {
        throw err;
      }
      if (!(await this.autoTopUp(params.organizationId, err.needed))) {
        throw err;
      }
      return this._wallet.charge(params);
    } finally {
      // Keep the balance above the threshold for the next one, then check
      // whether what is scheduled next can still be paid for.
      this.autoTopUp(params.organizationId)
        .catch(() => false)
        .then(() => this.notifyIfShort(params.organizationId))
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
