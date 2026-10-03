import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import dayjs from 'dayjs';
import {
  InsufficientCreditsError,
  WalletService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';

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

@Injectable()
export class WalletBillingService {
  private _logger = new Logger(WalletBillingService.name);
  private _client?: Stripe;

  constructor(private _wallet: WalletService) {}

  private get stripe() {
    if (!walletPaymentsEnabled()) {
      throw new Error('Wallet payments are not configured');
    }
    this._client ??= new Stripe(process.env.WALLET_STRIPE_SECRET_KEY!);
    return this._client;
  }

  private async taxEnabled() {
    return (await this._wallet.settings())['stripe_tax'] === 'on';
  }

  private async customerFor(organizationId: string, email?: string, name?: string) {
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

  async createCheckout(params: {
    organizationId: string;
    email?: string;
    name?: string;
    pence: number;
    saveCard: boolean;
    returnUrl: string;
  }) {
    const rules = await this._wallet.topUpRules();
    if (!Number.isInteger(params.pence) || params.pence < rules.minPence) {
      throw new Error(`The minimum top-up is £${(rules.minPence / 100).toFixed(2)}`);
    }

    const customer = await this.customerFor(
      params.organizationId,
      params.email,
      params.name
    );
    const units = await this._wallet.unitsForPence(params.pence);
    const metadata = {
      service: SERVICE,
      kind: 'topup',
      organizationId: params.organizationId,
      pence: String(params.pence),
    };
    const tax = await this.taxEnabled();

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer,
      customer_update: tax ? { address: 'auto', name: 'auto' } : undefined,
      automatic_tax: { enabled: tax },
      billing_address_collection: tax ? 'required' : undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'gbp',
            unit_amount: params.pence,
            tax_behavior: tax ? 'exclusive' : undefined,
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
      success_url: `${params.returnUrl}?topup=success`,
      cancel_url: `${params.returnUrl}?topup=cancelled`,
    });
    return { url: session.url };
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
    }
    return { ok: true };
  }

  private async checkoutPaid(session: Stripe.Checkout.Session) {
    if (session.metadata?.service !== SERVICE || session.payment_status !== 'paid') {
      return { ok: true };
    }
    const organizationId = session.metadata.organizationId;
    const pence = Number(session.metadata.pence);
    // Credit what was asked for, not what Stripe says before tax, and only if
    // the two agree.
    if (!organizationId || !pence || session.amount_subtotal !== pence) {
      this._logger.error(`Top-up ${session.id} does not match its metadata`);
      return { ok: false };
    }
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntentId) {
      return { ok: false };
    }

    await this._wallet.addTopUp({
      organizationId,
      pence,
      auto: false,
      paymentIntentId,
    });
    await this.rememberCard(organizationId, paymentIntentId);
    return { ok: true };
  }

  // Keeps the card saved during checkout, if the customer agreed to save it.
  private async rememberCard(organizationId: string, paymentIntentId: string) {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method'],
    });
    const method = intent.payment_method as Stripe.PaymentMethod | null;
    if (!intent.setup_future_usage || !method?.id) {
      return;
    }
    await this._wallet.updateWallet(organizationId, {
      paymentMethodId: method.id,
      cardBrand: method.card?.brand || null,
      cardLast4: method.card?.last4 || null,
    });
  }

  private async autoTopUpPaid(intent: Stripe.PaymentIntent) {
    if (intent.metadata?.service !== SERVICE || intent.metadata.kind !== 'auto_topup') {
      return { ok: true };
    }
    await this._wallet.addTopUp({
      organizationId: intent.metadata.organizationId,
      pence: Number(intent.metadata.pence),
      auto: true,
      paymentIntentId: intent.id,
    });
    return { ok: true };
  }

  private async autoTopUpFailed(intent: Stripe.PaymentIntent) {
    if (intent.metadata?.service !== SERVICE || intent.metadata.kind !== 'auto_topup') {
      return { ok: true };
    }
    // Stop retrying a card that fails; the customer turns it back on.
    await this._wallet.updateWallet(intent.metadata.organizationId, {
      autoTopUp: false,
    });
    return { ok: true };
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
      !wallet.paymentMethodId ||
      !wallet.stripeCustomerId ||
      !wallet.autoTopUpAmountPence
    ) {
      return false;
    }

    const balance = await this._wallet.balance(organizationId);
    const threshold = wallet.autoTopUpThreshold || 0;
    if (balance >= threshold && balance >= needed) {
      return false;
    }

    const pence = wallet.autoTopUpAmountPence;
    const spent = await this._wallet.autoTopUpPenceSince(
      organizationId,
      dayjs().startOf('month').toDate()
    );
    if (wallet.autoTopUpMonthlyCapPence && spent + pence > wallet.autoTopUpMonthlyCapPence) {
      return false;
    }
    if (balance + (await this._wallet.unitsForPence(pence)) < needed) {
      return false;
    }

    const metadata = {
      service: SERVICE,
      kind: 'auto_topup',
      organizationId,
      pence: String(pence),
    };

    try {
      let amount = pence;
      let calculation: Stripe.Tax.Calculation | undefined;
      if (await this.taxEnabled()) {
        calculation = await this.stripe.tax.calculations.create({
          currency: 'gbp',
          customer: wallet.stripeCustomerId,
          line_items: [
            { amount: pence, reference: 'credits', tax_behavior: 'exclusive' },
          ],
        });
        amount = calculation.amount_total;
      }

      // One attempt per wallet per ten minutes, however many posts ask for it.
      const intent = await this.stripe.paymentIntents.create(
        {
          amount,
          currency: 'gbp',
          customer: wallet.stripeCustomerId,
          payment_method: wallet.paymentMethodId,
          off_session: true,
          confirm: true,
          description: 'Voholabs Studio automatic top-up',
          metadata,
        },
        {
          idempotencyKey: `wallet-auto:${organizationId}:${Math.floor(Date.now() / 600_000)}`,
        }
      );

      if (intent.status !== 'succeeded') {
        return false;
      }
      if (calculation) {
        await this.stripe.tax.transactions.createFromCalculation({
          calculation: calculation.id,
          reference: intent.id,
        });
      }
      await this.autoTopUpPaid(intent);
      return true;
    } catch (err) {
      this._logger.warn(`Auto top-up failed for ${organizationId}: ${err}`);
      await this._wallet.updateWallet(organizationId, { autoTopUp: false });
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
      // Keep the balance above the threshold for the next one.
      this.autoTopUp(params.organizationId).catch(() => undefined);
    }
  }
}
