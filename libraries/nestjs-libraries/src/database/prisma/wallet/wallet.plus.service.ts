import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Stripe from 'stripe';
import { Wallet } from '@prisma/client';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId as organizationIdAttribute } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import {
  BILLING,
  PLUS,
  PLUS_ACTIVE_STATUSES,
  PLUS_OPEN_STATUSES,
  WalletService,
  planPeriods,
  plusIsActive,
  plusPaymentFailed,
  walletFrozenMessage,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import {
  WalletBillingService,
  cardExpired,
  walletPaymentsEnabled,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.billing.service';
import { WalletRepository } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.repository';
import { walletAlert } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert';
import { escapeHtml } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.plugs';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';

// Plus: one subscription, paid monthly or yearly on the wallet's Stripe
// account (never Postiz's own billing), that grants plan credits every plan
// period and opens the paid features and top-ups. Every number comes from
// BillingSetting (PLUS); without them Plus is not offered. The plan credits
// themselves are WalletService.syncPlan's.

const SERVICE = 'wallet';
const KIND = 'plus';
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
// The spans a release count is shown for (a paid month and a paid year).
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;
// Stripe keeps a Checkout session open between 30 minutes and 24 hours.
const SESSION_MIN_MS = 31 * MINUTE_MS;
const SESSION_MAX_MS = 23 * HOUR_MS;

export type PlusIntervalName = 'month' | 'year';

export interface PlusInterval {
  interval: PlusIntervalName;
  // The whole payment, in the smallest unit of the currency.
  price: number;
  // Plan credit grants one payment covers (1 a month, 12 a year of 30-day
  // periods).
  releases: number;
  pricePerRelease: number;
  // What the same plan credits (every release of one payment) cost as
  // top-ups, in the smallest unit of the currency.
  topUpPrice: number;
  // How much cheaper the payment is than those top-ups, whole percent,
  // rounded down so it is never overstated.
  savingPercent: number;
}

export interface PlusOffer {
  currency: string;
  // Whole credits granted each plan period.
  creditsPerPeriod: number;
  periodDays: number;
  // Credits a top-up buys for one unit of the currency.
  topUpCreditsPerUnit: number;
  intervals: PlusInterval[];
}

export interface PlusEarlyBird {
  percent: number;
  expiresAt: Date;
  // In the extension that follows the first window.
  extended: boolean;
  // The workspace's personal code: typed (or already applied) at Stripe
  // Checkout, it takes `percent` off the first payment.
  code: string;
}

export class PlusUnavailableError extends Error {}

// Checkout refused because the workspace already has a Plus subscription
// that has not ended (on, or a failed payment Stripe is still collecting).
export class PlusExistsError extends PlusUnavailableError {}

export const plusPaymentFailedMessage = () =>
  'Your Plus payment failed. Update your card to keep Plus; there is no need to subscribe again.';

// A setting as a number above zero, or undefined.
const positive = (value?: string) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n > 0
    ? n
    : undefined;
};

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : value?.id;

// Whether a subscription's latest invoice is paid and is the one of the span
// starting at `spanStart` (unix seconds): its line covers that span, or it
// was billed at its start.
const spanInvoicePaid = (
  subscription: Stripe.Subscription,
  spanStart: number
) => {
  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === 'string' || invoice.status !== 'paid') {
    return false;
  }
  return (
    (invoice.lines?.data || []).some((l) => l.period?.start === spanStart) ||
    invoice.period_end === spanStart
  );
};

// Letters and digits that can't be misread (no 0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// A workspace's early-bird code, like "MEHR-7K2QX": up to four letters of
// its admin's email, then characters derived from the workspace and when its
// early bird started (the same every time, so a retry asks Stripe for the
// same code).
export const earlyBirdCodeText = (
  organizationId: string,
  startedAt: Date,
  email?: string
) => {
  const name =
    (email || '')
      .split('@')[0]
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 4) || 'PLUS';
  const hash = createHash('sha256')
    .update(`${organizationId}:${startedAt.getTime()}`)
    .digest();
  const suffix = Array.from(hash.subarray(0, 5))
    .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join('');
  return `${name}-${suffix}`;
};

@Injectable()
export class WalletPlusService {
  private _logger = new Logger(WalletPlusService.name);
  // Workspaces whose early-bird code failed and were alerted about: the
  // plan is read on every page, so the alert goes out once, not each time.
  private _codeAlerted = new Set<string>();

  constructor(
    private _wallet: WalletService,
    private _billing: WalletBillingService,
    private _repository: WalletRepository,
    private _notifications: NotificationService,
    private _temporal: TemporalService
  ) {}

  // What Plus costs and gives, from the settings, or null when it is not
  // offered (a setting is missing, or wallet payments are off). Never throws.
  async offer(): Promise<PlusOffer | null> {
    try {
      if (!walletPaymentsEnabled()) {
        return null;
      }
      const settings = await this._wallet.settings();
      const credits = positive(settings[PLUS.credits]);
      const periodDays = positive(settings[PLUS.periodDays]);
      const creditsPerUnit = positive(settings[BILLING.creditsPerUnit]);
      if (
        !credits ||
        !periodDays ||
        !Number.isInteger(periodDays) ||
        !creditsPerUnit
      ) {
        return null;
      }
      const [currency, minorPerUnit] = await Promise.all([
        this._wallet.currency(),
        this._wallet.minorPerUnit(),
      ]);
      const intervals: PlusInterval[] = [];
      for (const [interval, key, days] of [
        ['month', PLUS.monthlyPrice, MONTH_DAYS],
        ['year', PLUS.annualPrice, YEAR_DAYS],
      ] as const) {
        const price = positive(settings[key]);
        if (!price || !Number.isInteger(price)) {
          continue;
        }
        const releases = planPeriods(
          new Date(0),
          new Date(days * DAY_MS),
          periodDays
        ).length;
        // The same credits as top-ups: credits / credits per unit.
        const topUp = (releases * credits * minorPerUnit) / creditsPerUnit;
        intervals.push({
          interval,
          price,
          releases,
          pricePerRelease: Math.round(price / releases),
          topUpPrice: Math.round(topUp),
          // The small epsilon keeps an exact 10% from flooring to 9%.
          savingPercent: Math.max(
            0,
            Math.floor((1 - price / topUp) * 100 + 1e-9)
          ),
        });
      }
      if (!intervals.length) {
        return null;
      }
      return {
        currency,
        creditsPerPeriod: credits,
        periodDays,
        topUpCreditsPerUnit: creditsPerUnit,
        intervals,
      };
    } catch (err) {
      this._logger.error(
        `Plus offer could not be read: ${
          err instanceof Error ? err.message : err
        }`
      );
      return null;
    }
  }

  // The early bird's windows for a workspace: it starts when onboarding's
  // last step decides the welcome credits (claimed or skipped, whichever came
  // first), lasts `minutes`, then `extensionHours` more. Never for a
  // workspace that ever had Plus (the first payment only), and not without
  // the settings.
  async earlyBirdWindow(organizationId: string) {
    const settings = await this._wallet.settings();
    const percent = positive(settings[PLUS.earlyBirdPercent]);
    const minutes = positive(settings[PLUS.earlyBirdMinutes]);
    const extensionHours =
      positive(settings[PLUS.earlyBirdExtensionHours]) || 0;
    if (!percent || percent >= 100 || !minutes) {
      return undefined;
    }
    const [claimedAt, wallet] = await Promise.all([
      this._wallet.welcomeClaimedAt(organizationId),
      this._wallet.getWallet(organizationId),
    ]);
    const decided = [claimedAt, wallet?.welcomeCreditsSkippedAt]
      .filter((d): d is Date => !!d)
      .map((d) => d.getTime());
    if (!decided.length || wallet?.plusSubscriptionId) {
      return undefined;
    }
    const startedAt = new Date(Math.min(...decided));
    const firstEnd = new Date(startedAt.getTime() + minutes * MINUTE_MS);
    return {
      percent,
      startedAt,
      firstEnd,
      end: new Date(firstEnd.getTime() + extensionHours * HOUR_MS),
    };
  }

  // The early bird valid now, with the workspace's code, or null (also
  // while its code could not be made: without it there is no discount).
  // Never throws.
  async earlyBird(
    organizationId: string,
    offer?: PlusOffer | null,
    now = new Date()
  ): Promise<PlusEarlyBird | null> {
    return (
      (await this.liveEarlyBird(organizationId, offer, now))?.earlyBird || null
    );
  }

  // The early bird valid now and its Stripe promotion code id (kept off the
  // API answers), or null. Never throws.
  private async liveEarlyBird(
    organizationId: string,
    offer?: PlusOffer | null,
    now = new Date()
  ): Promise<{ earlyBird: PlusEarlyBird; codeId: string } | null> {
    try {
      const plusOffer = offer === undefined ? await this.offer() : offer;
      const window = await this.earlyBirdWindow(organizationId);
      if (!plusOffer || !window || now.getTime() >= window.end.getTime()) {
        return null;
      }
      const code = await this.earlyBirdCode(organizationId, window).catch(
        async (err) => {
          // Without its code the offer shows no discount at all, so a
          // person hears of it (once per workspace until a code is made).
          const message = `Early-bird code for ${organizationId} could not be made: ${
            err instanceof Error ? err.message : err
          }`;
          this._logger.error(message);
          if (!this._codeAlerted.has(organizationId)) {
            this._codeAlerted.add(organizationId);
            await walletAlert(message);
          }
          return null;
        }
      );
      if (!code) {
        return null;
      }
      this._codeAlerted.delete(organizationId);
      const extended = now.getTime() >= window.firstEnd.getTime();
      return {
        codeId: code.id,
        earlyBird: {
          percent: window.percent,
          expiresAt: extended ? window.end : window.firstEnd,
          extended,
          code: code.code,
        },
      };
    } catch (err) {
      this._logger.error(
        `Early bird for ${organizationId} could not be read: ${
          err instanceof Error ? err.message : err
        }`
      );
      return null;
    }
  }

  // The workspace's early-bird code, made once on the wallet's Stripe
  // account: a promotion code for the workspace's Stripe customer only,
  // redeemable once, for a coupon of the setting's percent off the first
  // payment. It expires at the end of the whole early bird (the first window
  // and its extension): Stripe can't move a code's expiry, and the two
  // windows follow each other, so the extension needs no new code. A retry
  // re-uses the stored code, or gets the same one back from Stripe.
  private async earlyBirdCode(
    organizationId: string,
    window: NonNullable<
      Awaited<ReturnType<WalletPlusService['earlyBirdWindow']>>
    >
  ) {
    const wallet = await this._wallet.getWallet(organizationId);
    if (wallet?.plusEarlyBirdCodeId && wallet.plusEarlyBirdCode) {
      return { id: wallet.plusEarlyBirdCodeId, code: wallet.plusEarlyBirdCode };
    }
    const [email] = await this._repository.adminEmails(organizationId);
    const customer = await this._billing.customerFor(organizationId, email);
    const redeemBy = Math.floor(window.end.getTime() / 1000);
    // The keys carry every parameter, so a retry after a settings change is
    // a new request, not one Stripe refuses as a changed repeat. The code's
    // key carries the customer too: a new customer gets its own code.
    const key = `${organizationId}:${window.startedAt.getTime()}:${
      window.percent
    }:${redeemBy}`;
    const metadata = {
      service: SERVICE,
      kind: 'plus_early_bird',
      organizationId,
    };
    const coupon = await this._billing.stripe.coupons.create(
      {
        percent_off: window.percent,
        duration: 'once',
        max_redemptions: 1,
        redeem_by: redeemBy,
        name: `Early bird ${window.percent}% off`,
        metadata,
      },
      { idempotencyKey: `plus-early-bird-coupon:${key}` }
    );
    const text = earlyBirdCodeText(organizationId, window.startedAt, email);
    const promotion = await this._billing.stripe.promotionCodes
      .create(
        {
          promotion: { type: 'coupon', coupon: coupon.id },
          code: text,
          customer,
          max_redemptions: 1,
          expires_at: redeemBy,
          metadata,
        },
        { idempotencyKey: `plus-early-bird-code:${key}:${coupon.id}:${customer}` }
      )
      .catch(async (err) => {
        // Made before but not kept (the database failed after Stripe
        // answered): the same code is there already, so it is taken.
        const [made] = (
          await this._billing.stripe.promotionCodes.list({
            code: text,
            customer,
            active: true,
            limit: 1,
          })
        ).data;
        if (!made) {
          throw err;
        }
        return made;
      });
    if (
      !(await this._repository.setEarlyBirdCode(
        organizationId,
        promotion.id,
        promotion.code
      ))
    ) {
      // Another call kept its code first: that one is the workspace's.
      const kept = await this._wallet.getWallet(organizationId);
      return kept?.plusEarlyBirdCodeId && kept.plusEarlyBirdCode
        ? { id: kept.plusEarlyBirdCodeId, code: kept.plusEarlyBirdCode }
        : null;
    }
    return { id: promotion.id, code: promotion.code };
  }

  // What each Plus subscription bills now, read from Stripe: its item's
  // price and interval, and whether a discount takes all of it (a comped
  // subscription). Read by the growth dashboard, so nothing is thrown: a
  // subscription Stripe could not return is left out.
  async subscriptionPrices(subscriptionIds: string[]) {
    const prices = new Map<
      string,
      { amount: number; currency: string; interval: string; comped: boolean }
    >();
    if (!subscriptionIds.length || !walletPaymentsEnabled()) {
      return prices;
    }
    await Promise.all(
      subscriptionIds.map(async (id) => {
        try {
          const subscription =
            await this._billing.stripe.subscriptions.retrieve(id, {
              expand: ['discounts.source.coupon'],
            });
          const price = subscription.items?.data?.[0]?.price;
          if (!price?.unit_amount || !price.recurring) {
            return;
          }
          const amount = price.unit_amount;
          const comped = (subscription.discounts || []).some((discount) => {
            const coupon =
              typeof discount === 'string' ? null : discount.source?.coupon;
            return (
              !!coupon &&
              typeof coupon !== 'string' &&
              ((coupon.percent_off || 0) >= 100 ||
                (coupon.amount_off || 0) >= amount)
            );
          });
          prices.set(id, {
            amount,
            currency: price.currency.toUpperCase(),
            interval: price.recurring.interval,
            comped,
          });
        } catch (err) {
          this._logger.error(
            `Plus subscription ${id} could not be read: ${
              err instanceof Error ? err.message : err
            }`
          );
        }
      })
    );
    return prices;
  }

  // Everything the Plus and wallet pages show.
  async plan(organizationId: string) {
    const offer = await this.offer();
    const [earlyBird, credits, access, wallet] = await Promise.all([
      this.earlyBird(organizationId, offer),
      this._wallet.planCredits(organizationId),
      this._wallet.access(organizationId),
      this._wallet.getWallet(organizationId),
    ]);
    return {
      serverNow: new Date(),
      paymentsEnabled: walletPaymentsEnabled(),
      offer,
      earlyBird,
      subscription: wallet?.plusSubscriptionId
        ? {
            active: plusIsActive(wallet),
            // Stripe is still collecting a failed payment: the card needs
            // updating (billingPortal), not a new subscription.
            paymentFailed: plusPaymentFailed(wallet),
            status: wallet.plusStatus || 'unknown',
            interval: (wallet.plusInterval as PlusIntervalName) || null,
            periodEnd: wallet.plusPeriodEnd,
            cancelAt: wallet.plusCancelAt,
            creditsPerPeriod: (wallet.plusCredits || 0) / 100,
          }
        : null,
      credits,
      access: {
        plus: access.plus,
        legacy: access.legacy,
        grandfathered: access.grandfathered,
        open: access.open,
        topUpAllowed: access.topUpAllowed,
        frozen: access.frozen,
      },
    };
  }

  // Stripe Checkout in subscription mode, priced from the settings (no
  // prices kept in Stripe). While the early bird is valid its code is
  // already applied (it takes its percent off the first payment only) and
  // the session closes when it expires; otherwise a code can be typed at
  // Checkout, and Stripe refuses one that has expired.
  async createCheckout(params: {
    organizationId: string;
    email?: string;
    name?: string;
    interval: PlusIntervalName;
    returnUrl: string;
  }) {
    const offer = await this.offer();
    const option = offer?.intervals.find((i) => i.interval === params.interval);
    if (!offer || !option) {
      throw new PlusUnavailableError('Plus is not available yet');
    }
    if (await this._wallet.isFrozen(params.organizationId)) {
      throw new PlusUnavailableError(walletFrozenMessage());
    }
    await this.assertNoOpenSubscription(params.organizationId);
    const currency = await this._billing.currencyFor(params.organizationId);
    const customer = await this._billing.customerFor(
      params.organizationId,
      params.email,
      params.name
    );
    const live = await this.liveEarlyBird(params.organizationId, offer);

    // What this subscription grants is fixed now; its webhooks read it back.
    const metadata: Record<string, string> = {
      service: SERVICE,
      kind: KIND,
      organizationId: params.organizationId,
      interval: params.interval,
      price: String(option.price),
      currency,
      credits: String(Math.round(offer.creditsPerPeriod * 100)),
      periodDays: String(offer.periodDays),
    };

    const now = Date.now();
    const sessionParams = (
      early?: typeof live
    ): Stripe.Checkout.SessionCreateParams => {
      const meta = early
        ? { ...metadata, earlyBirdPercent: String(early.earlyBird.percent) }
        : metadata;
      return {
        mode: 'subscription',
        customer,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: option.price,
              recurring: { interval: params.interval },
              product_data: {
                name: 'Voholabs Studio Plus',
                description: `${offer.creditsPerPeriod.toLocaleString(
                  'en-GB'
                )} credits every ${offer.periodDays} days`,
              },
            },
          },
        ],
        subscription_data: { metadata: meta },
        metadata: meta,
        // Stripe takes one of the two: the code applied, or a field to type
        // one. With the code, the session closes when the offer does.
        ...(early
          ? {
              discounts: [{ promotion_code: early.codeId }],
              expires_at: Math.floor(
                Math.min(
                  Math.max(
                    early.earlyBird.expiresAt.getTime(),
                    now + SESSION_MIN_MS
                  ),
                  now + SESSION_MAX_MS
                ) / 1000
              ),
            }
          : { allow_promotion_codes: true }),
        success_url: `${params.returnUrl}?plus=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${params.returnUrl}?plus=cancelled`,
      };
    };
    let session: Stripe.Checkout.Session;
    try {
      session = await this._billing.stripe.checkout.sessions.create(
        sessionParams(live || undefined)
      );
    } catch (err) {
      if (!live) {
        throw err;
      }
      // Stripe refused the code (switched off at Stripe, or the settings
      // moved past what it was made with): checkout goes on without it, and
      // a code can still be typed there.
      this._logger.error(
        `Early-bird code of ${params.organizationId} refused at checkout: ${
          err instanceof Error ? err.message : err
        }`
      );
      session = await this._billing.stripe.checkout.sessions.create(
        sessionParams()
      );
    }
    return { url: session.url };
  }

  // Refuses a second subscription while the one on record has not ended:
  // on, or a failed payment Stripe is still collecting. The record is read
  // again from Stripe first, so one that ended since is no obstacle.
  private async assertNoOpenSubscription(organizationId: string) {
    const open = (wallet: Awaited<ReturnType<WalletService['getWallet']>>) =>
      !!wallet?.plusSubscriptionId &&
      PLUS_OPEN_STATUSES.includes(wallet.plusStatus || '');
    const recorded = await this._wallet.getWallet(organizationId);
    if (!open(recorded)) {
      return;
    }
    try {
      await this.syncSubscription(recorded!.plusSubscriptionId!);
    } catch (err) {
      this._logger.error(
        `Plus subscription ${
          recorded!.plusSubscriptionId
        } could not be read again: ${err instanceof Error ? err.message : err}`
      );
    }
    const wallet = await this._wallet.getWallet(organizationId);
    if (!open(wallet)) {
      return;
    }
    throw new PlusExistsError(
      plusPaymentFailed(wallet)
        ? plusPaymentFailedMessage()
        : 'This workspace already has Plus.'
    );
  }

  // A Stripe billing portal session for the wallet's Stripe customer, where
  // the card that pays for Plus is updated (Stripe then collects a failed
  // payment again). Returns to /plus.
  async billingPortal(organizationId: string) {
    const wallet = await this._wallet.getWallet(organizationId);
    if (!wallet?.stripeCustomerId || !wallet.plusSubscriptionId) {
      throw new PlusUnavailableError('This workspace has no Plus to change.');
    }
    const session = await this._billing.stripe.billingPortal.sessions.create({
      customer: wallet.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/plus`,
      // Straight to the card, nothing else of the portal.
      flow_data: { type: 'payment_method_update' },
    });
    return { url: session.url };
  }

  // The browser came back from Checkout: record the subscription now (the
  // webhook may not have arrived yet). False when the session is not this
  // workspace's Plus checkout.
  async confirmCheckout(organizationId: string, sessionId: string) {
    const session = await this._billing.stripe.checkout.sessions.retrieve(
      sessionId
    );
    if (
      session.metadata?.service !== SERVICE ||
      session.metadata.kind !== KIND ||
      session.metadata.organizationId !== organizationId
    ) {
      return false;
    }
    const subscriptionId = idOf(session.subscription);
    if (subscriptionId) {
      await this.syncSubscription(subscriptionId);
    }
    return true;
  }

  // Ends Plus at the end of the paid span (the credits and access stay
  // until then), or takes that back.
  async setCancelled(organizationId: string, cancelled: boolean) {
    const wallet = await this._wallet.getWallet(organizationId);
    if (!wallet?.plusSubscriptionId || !plusIsActive(wallet)) {
      throw new PlusUnavailableError('This workspace has no Plus to change.');
    }
    await this._billing.stripe.subscriptions.update(wallet.plusSubscriptionId, {
      cancel_at_period_end: cancelled,
    });
    await this.syncSubscription(wallet.plusSubscriptionId);
  }

  // A Plus event from the wallet's Stripe webhook, or undefined when the
  // event is not about Plus (WalletBillingService handles the rest). Never
  // throws: a failure is logged and alerted, and the next event or the
  // browser's return records the subscription again from Stripe.
  async handleEvent(event: Stripe.Event) {
    if (event.type === 'customer.updated') {
      return this.customerUpdated(event);
    }
    const subscriptionId = this.subscriptionOf(event);
    if (!subscriptionId) {
      return undefined;
    }
    try {
      await this.syncSubscription(subscriptionId);
    } catch (err) {
      await walletAlert(
        `Plus event ${event.id} (${
          event.type
        }) for subscription ${subscriptionId} could not be recorded: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
    return { ok: true };
  }

  // A wallet customer's default card changed at Stripe (the billing portal
  // sets it): its Plus subscription, when one is on record and has not
  // ended, is recorded again, which brings the wallet card along (see
  // syncCard). Undefined for another customer. Never throws.
  private async customerUpdated(event: Stripe.CustomerUpdatedEvent) {
    const customer = event.data.object;
    if (customer.metadata?.service !== SERVICE) {
      return undefined;
    }
    if (!event.data.previous_attributes?.invoice_settings) {
      return { ok: true };
    }
    try {
      const wallet = await this._wallet.getWalletByCustomer(customer.id);
      if (
        wallet?.plusSubscriptionId &&
        PLUS_OPEN_STATUSES.includes(wallet.plusStatus || '')
      ) {
        await this.syncSubscription(wallet.plusSubscriptionId);
      }
    } catch (err) {
      await walletAlert(
        `Plus event ${event.id} (customer.updated) for customer ${
          customer.id
        } could not be recorded: ${err instanceof Error ? err.message : err}`
      );
    }
    return { ok: true };
  }

  // The Plus subscription an event is about, if it is one.
  private subscriptionOf(event: Stripe.Event) {
    const isPlus = (metadata?: Stripe.Metadata | null) =>
      metadata?.service === SERVICE && metadata?.kind === KIND;
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        return session.mode === 'subscription' && isPlus(session.metadata)
          ? idOf(session.subscription)
          : undefined;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const details = (event.data.object as Stripe.Invoice).parent
          ?.subscription_details;
        return details && isPlus(details.metadata)
          ? idOf(details.subscription)
          : undefined;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        return isPlus(subscription.metadata) ? subscription.id : undefined;
      }
    }
    return undefined;
  }

  // Records a Plus subscription as Stripe has it now (read fresh, so events
  // arriving out of order or twice change nothing), then brings the plan
  // credits up to date.
  async syncSubscription(subscriptionId: string) {
    const subscription = await this._billing.stripe.subscriptions.retrieve(
      subscriptionId,
      { expand: ['latest_invoice'] }
    );
    const metadata = subscription.metadata || {};
    const organizationId = metadata.organizationId;
    if (metadata.service !== SERVICE || metadata.kind !== KIND) {
      return;
    }
    const wallet = organizationId
      ? await this._wallet.getWallet(organizationId)
      : null;
    if (
      !wallet?.stripeCustomerId ||
      wallet.stripeCustomerId !== idOf(subscription.customer)
    ) {
      await walletAlert(
        `Plus subscription ${subscription.id} (org ${organizationId}) does not match its wallet's Stripe customer. Nothing was recorded.`
      );
      return;
    }
    const goodStanding = PLUS_ACTIVE_STATUSES.includes(subscription.status);
    // Another subscription than the one on record: only taken over when the
    // one on record is no longer active.
    if (
      wallet.plusSubscriptionId &&
      wallet.plusSubscriptionId !== subscription.id &&
      plusIsActive(wallet)
    ) {
      if (goodStanding) {
        await walletAlert(
          `Org ${organizationId} has a second Plus subscription ${subscription.id} while ${wallet.plusSubscriptionId} is active. Refund and cancel one of them.`
        );
      }
      return;
    }
    const credits = Number(metadata.credits);
    const periodDays = Number(metadata.periodDays);
    const item = subscription.items?.data?.[0];
    if (
      !Number.isInteger(credits) ||
      credits <= 0 ||
      !Number.isInteger(periodDays) ||
      periodDays <= 0 ||
      !item?.current_period_start ||
      !item.current_period_end
    ) {
      await walletAlert(
        `Plus subscription ${subscription.id} (org ${organizationId}) has no credits, period or billing period to record. Nothing was recorded.`
      );
      return;
    }
    const periodStart = new Date(item.current_period_start * 1000);
    let periodEnd = new Date(item.current_period_end * 1000);
    if (subscription.ended_at) {
      periodEnd = new Date(
        Math.min(periodEnd.getTime(), subscription.ended_at * 1000)
      );
    }
    const cancelAt = subscription.cancel_at
      ? new Date(subscription.cancel_at * 1000)
      : subscription.cancel_at_period_end
      ? periodEnd
      : null;
    const wasActive = plusIsActive(wallet);
    // The span's plan credits wait for its invoice to be paid: a renewal is
    // billed as a draft first, and its payment can still fail.
    const paidPeriodStart = spanInvoicePaid(
      subscription,
      item.current_period_start
    )
      ? periodStart
      : wallet.plusSubscriptionId === subscription.id
      ? wallet.plusPaidPeriodStart
      : null;
    await this._wallet.updateWallet(organizationId, {
      plusSubscriptionId: subscription.id,
      plusStatus: subscription.status,
      plusInterval:
        item.price?.recurring?.interval || metadata.interval || null,
      plusPeriodStart: periodStart,
      plusPeriodEnd: periodEnd,
      plusCancelAt: cancelAt,
      plusPaidPeriodStart: paidPeriodStart,
      plusCredits: credits,
      plusPeriodDays: periodDays,
    });
    await this._wallet.syncPlan(organizationId);
    if (!wallet.plusSubscriptionId && wallet.plusEarlyBirdCodeId) {
      await this.endEarlyBirdCode(organizationId, wallet.plusEarlyBirdCodeId);
    }
    const isActive = plusIsActive({
      plusSubscriptionId: subscription.id,
      plusStatus: subscription.status,
      plusPeriodEnd: periodEnd,
      frozenAt: wallet.frozenAt,
    });
    if (!wasActive && isActive) {
      await this._wallet.notify(
        organizationId,
        'Plus is on',
        'Plus is on: your plan credits are in your wallet, and X posting, research data and top-ups are open.',
        'success'
      );
    }
    if (PLUS_OPEN_STATUSES.includes(subscription.status)) {
      await this.syncCard(wallet, subscription);
    } else {
      await this.endAutoTopUp(organizationId, subscription.id);
    }
  }

  // Keeps the wallet's card and the card Plus pays with in step, from
  // Stripe's side (WalletBillingService.cardForPlus does it from the
  // wallet's):
  // - a subscription's first card becomes the wallet's card when the wallet
  //   has none, or its card has expired or is no longer the customer's (a
  //   usable wallet card is kept, and Plus keeps paying with its own);
  // - a card changed at Stripe later (the billing portal sets the
  //   customer's default, and may set the subscription's) becomes the
  //   wallet's card, and the subscription's and customer's default.
  // Compared with the card last recorded, so the same event twice changes
  // nothing. Never throws: a failure is alerted, and the next event of the
  // subscription tries again.
  private async syncCard(wallet: Wallet, subscription: Stripe.Subscription) {
    const organizationId = wallet.organizationId;
    try {
      const customer = await this._billing.stripe.customers.retrieve(
        wallet.stripeCustomerId!
      );
      const customerCard =
        'deleted' in customer && customer.deleted
          ? undefined
          : idOf(
              (customer as Stripe.Customer).invoice_settings
                ?.default_payment_method
            );
      const subscriptionCard = idOf(subscription.default_payment_method);
      const recorded =
        wallet.plusSubscriptionId === subscription.id
          ? wallet.plusPaymentMethodId
          : null;

      if (!recorded) {
        const card =
          subscriptionCard ||
          (await this.invoiceCard(subscription)) ||
          customerCard;
        if (!card) {
          this._logger.log(
            `Plus subscription ${subscription.id} of ${organizationId} has no card yet; the wallet card was left as it was.`
          );
          return;
        }
        if (!(await this.walletCardUsable(wallet))) {
          await this.keepCard(wallet, card).catch(async (err) => {
            // Stripe refused the card for good (it can't be attached): it is
            // recorded anyway, so this is alerted once, not every event.
            if (
              (err as { type?: string })?.type !== 'StripeInvalidRequestError'
            ) {
              throw err;
            }
            await walletAlert(
              `Plus card ${card} (org ${organizationId}) could not be kept as the wallet card: ${err.message}`
            );
          });
        }
        await this._wallet.updateWallet(organizationId, {
          plusPaymentMethodId: card,
        });
        return;
      }

      const changed = [subscriptionCard, customerCard].find(
        (card): card is string => !!card && card !== recorded
      );
      if (!changed) {
        return;
      }
      if (await this.keepCard(wallet, changed)) {
        await this._billing.cardForPlus(organizationId, changed);
      } else {
        await this._wallet.updateWallet(organizationId, {
          plusPaymentMethodId: changed,
        });
      }
    } catch (err) {
      await walletAlert(
        `The card of Plus subscription ${
          subscription.id
        } (org ${organizationId}) could not be kept in step with the wallet card: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  // The card that paid a subscription's latest invoice, if any.
  private async invoiceCard(subscription: Stripe.Subscription) {
    const invoiceId = idOf(subscription.latest_invoice);
    if (!invoiceId) {
      return undefined;
    }
    const payments = await this._billing.stripe.invoicePayments.list({
      invoice: invoiceId,
      status: 'paid',
      expand: ['data.payment.payment_intent'],
      limit: 1,
    });
    const intent = payments.data[0]?.payment?.payment_intent;
    return idOf(
      typeof intent === 'string'
        ? (await this._billing.stripe.paymentIntents.retrieve(intent))
            .payment_method
        : intent?.payment_method
    );
  }

  // Whether the wallet's saved card can still be charged: it has one, it
  // has not expired, and it is still on the wallet's Stripe customer.
  private async walletCardUsable(wallet: Wallet) {
    if (!wallet.paymentMethodId || cardExpired(wallet.cardExp)) {
      return false;
    }
    try {
      const method = await this._billing.stripe.paymentMethods.retrieve(
        wallet.paymentMethodId
      );
      return idOf(method.customer) === wallet.stripeCustomerId;
    } catch (err) {
      if ((err as { code?: string })?.code === 'resource_missing') {
        return false;
      }
      throw err;
    }
  }

  // Keeps a Plus card as the wallet's card, attached to the wallet's Stripe
  // customer first if it is on none (auto top-up charges it off-session as
  // that customer; Checkout already saved it for off-session use). Returns
  // whether it was kept: only a card is, and never one of another customer.
  private async keepCard(wallet: Wallet, paymentMethodId: string) {
    let method = await this._billing.stripe.paymentMethods.retrieve(
      paymentMethodId
    );
    if (method.type !== 'card' || !method.card) {
      this._logger.log(
        `Plus payment method ${paymentMethodId} of ${wallet.organizationId} is not a card; the wallet card was left as it was.`
      );
      return false;
    }
    const customer = idOf(method.customer);
    if (customer && customer !== wallet.stripeCustomerId) {
      await walletAlert(
        `Plus payment method ${paymentMethodId} (org ${wallet.organizationId}) belongs to another Stripe customer. The wallet card was left as it was.`
      );
      return false;
    }
    if (!customer) {
      method = await this._billing.stripe.paymentMethods.attach(
        paymentMethodId,
        { customer: wallet.stripeCustomerId! }
      );
    }
    await this._billing.storeCard(wallet.organizationId, method);
    return true;
  }

  // Plus ended (cancelled, or Stripe stopped collecting it): top-ups need
  // Plus, so auto top-up goes off with it, and the wallet page says why. A
  // workspace on pay-as-you-go from before Plus keeps it. Never throws.
  private async endAutoTopUp(organizationId: string, subscriptionId: string) {
    try {
      if (await this._wallet.topUpAllowed(organizationId)) {
        return;
      }
      await this._billing.disableAutoTopUp(
        organizationId,
        `Plus subscription ${subscriptionId} ended`,
        'plus_ended'
      );
    } catch (err) {
      await walletAlert(
        `Auto top-up of org ${organizationId} could not be turned off after Plus subscription ${subscriptionId} ended: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  // The first Plus subscription is on record: the early bird is over for
  // good (the first payment only), so its code is switched off at Stripe
  // too. Never throws: the code still can't be used twice, and expires.
  private async endEarlyBirdCode(organizationId: string, codeId: string) {
    try {
      await this._billing.stripe.promotionCodes.update(codeId, {
        active: false,
      });
    } catch (err) {
      this._logger.error(
        `Early-bird code ${codeId} of ${organizationId} could not be switched off: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  // Makes the workspace's early-bird code and starts the workflow that sends
  // the one early-bird extension email. Called when the welcome credits are
  // claimed or skipped; never fails the caller.
  async startEarlyBird(organizationId: string) {
    try {
      if (!(await this.earlyBirdWindow(organizationId))) {
        return;
      }
      // Made now so the code is ready on the next screen; a failure here is
      // made good by the next read of the plan.
      await this.earlyBird(organizationId);
      await this._temporal.client
        .getRawClient()
        ?.workflow.start('plusEarlyBirdEmailWorkflow', {
          workflowId: `plus_early_bird_${organizationId}`,
          taskQueue: 'main',
          workflowIdConflictPolicy: 'USE_EXISTING',
          args: [{ organizationId }],
          typedSearchAttributes: new TypedSearchAttributes([
            { key: organizationIdAttribute, value: organizationId },
          ]),
        });
    } catch (err) {
      this._logger.error(
        `Early bird email for ${organizationId} could not be scheduled: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  // Milliseconds until the early bird's first window ends (when its
  // extension starts), or null when there is no extension to tell about.
  async earlyBirdEmailDelay(organizationId: string) {
    const window = await this.earlyBirdWindow(organizationId);
    if (!window || window.end.getTime() <= window.firstEnd.getTime()) {
      return null;
    }
    return Math.max(0, window.firstEnd.getTime() - Date.now());
  }

  // The one email saying the early bird was extended, to the workspace's
  // admins: only while the setting is on, the extension is running and the
  // workspace has not subscribed, and once ever. Returns whether it was sent.
  async sendEarlyBirdEmail(organizationId: string) {
    const settings = await this._wallet.settings();
    if ((settings[PLUS.earlyBirdEmail] || '').toLowerCase() !== 'on') {
      return false;
    }
    const offer = await this.offer();
    const [earlyBird, window] = await Promise.all([
      this.earlyBird(organizationId, offer),
      this.earlyBirdWindow(organizationId),
    ]);
    if (
      !offer ||
      !earlyBird?.extended ||
      !window ||
      (await this._wallet.hasPlus(organizationId))
    ) {
      return false;
    }
    const emails = await this._repository.adminEmails(organizationId);
    if (!emails.length) {
      return false;
    }
    if (!(await this._repository.claimEarlyBirdEmail(organizationId))) {
      return false;
    }
    const { subject, html } = await this.earlyBirdEmail(
      offer,
      earlyBird,
      window
    );
    try {
      for (const email of emails) {
        await this._notifications.sendEmail(email, subject, html);
      }
    } catch (err) {
      await this._repository.releaseEarlyBirdEmail(organizationId);
      throw err;
    }
    return true;
  }

  // The early-bird email exactly as sendEarlyBirdEmail renders it, sent to
  // the workspace's admins with "[Preview]" in the subject, to see it in a
  // real mail client. Uses the workspace's live early bird when it has one,
  // else a sample code and an expiry one extension from now (nothing is made
  // at Stripe). Never marks the real email as sent. Returns who it went to.
  async sendEarlyBirdEmailPreview(organizationId: string) {
    const offer = await this.offer();
    const settings = await this._wallet.settings();
    const percent = positive(settings[PLUS.earlyBirdPercent]);
    const minutes = positive(settings[PLUS.earlyBirdMinutes]);
    const extensionHours =
      positive(settings[PLUS.earlyBirdExtensionHours]) || 0;
    if (!offer || !percent || !minutes) {
      throw new PlusUnavailableError(
        'Plus or the early bird is not set up, so there is no email to preview.'
      );
    }
    const live = await this.earlyBird(organizationId, offer);
    const window = (live && (await this.earlyBirdWindow(organizationId))) || {
      percent,
      firstEnd: new Date(),
      end: new Date(Date.now() + extensionHours * HOUR_MS),
    };
    // As the real email shows it: during the extension, to the very end.
    const earlyBird: PlusEarlyBird = live
      ? { ...live, expiresAt: window.end, extended: true }
      : {
          percent,
          expiresAt: window.end,
          extended: true,
          code: earlyBirdCodeText(organizationId, new Date(0), 'preview'),
        };
    const { subject, html } = await this.earlyBirdEmail(
      offer,
      earlyBird,
      window
    );
    const emails = await this._repository.adminEmails(organizationId);
    for (const email of emails) {
      await this._notifications.sendEmail(email, `[Preview] ${subject}`, html);
    }
    return { sentTo: emails, sample: !live };
  }

  // The early-bird extension email: the personal code, what it gives and
  // until when, what Plus includes and costs against top-ups, and one way to
  // /plus. Every number from the settings. The body goes inside the shared
  // email layout (EmailService), so it is inline-styled tables with explicit
  // colours that read on light and dark mail clients, one column for phones.
  async earlyBirdEmail(
    offer: PlusOffer,
    earlyBird: PlusEarlyBird,
    window: { firstEnd: Date; end: Date }
  ) {
    const url = `${process.env.FRONTEND_URL}/plus`;
    const hours = Math.round(
      (window.end.getTime() - window.firstEnd.getTime()) / HOUR_MS
    );
    // The time really left, should the email go out late.
    const hoursLeft = Math.round(
      (earlyBird.expiresAt.getTime() - Date.now()) / HOUR_MS
    );
    const left =
      hoursLeft >= 2
        ? `, in ${hoursLeft} hours`
        : hoursLeft === 1
        ? ', in an hour'
        : '';
    const expires = `${new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC',
    })
      .format(earlyBird.expiresAt)
      .replace(/ at /, ', ')} UTC`;
    const credits = offer.creditsPerPeriod.toLocaleString('en-GB');
    const monthly =
      offer.intervals.find((i) => i.interval === 'month') || offer.intervals[0];
    const per = monthly.interval === 'year' ? 'a year' : 'a month';
    const [price, topUpPrice] = await Promise.all([
      this._wallet.formatMoney(monthly.price),
      this._wallet.formatMoney(monthly.topUpPrice),
    ]);
    const subject = `Your ${earlyBird.percent}% Plus code is extended for ${hours} hours`;
    const includes = [
      `${credits} credits every ${offer.periodDays} days`,
      'Posting to X and research data',
      'Every paid feature open, and top-ups any time',
    ];
    const font =
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;";
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;${font}color:#1f2937;">
<tr><td style="padding:0 0 16px 0;font-size:16px;line-height:24px;">Good news: we extended your early-bird offer by ${hours} hours. Your personal code still takes ${
      earlyBird.percent
    }% off your first Plus payment, monthly or annual.</td></tr>
<tr><td style="padding:0 0 20px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fdf3e4;border:1px solid #e8c48f;border-left:4px solid #b4762a;border-radius:8px;">
<tr><td style="padding:18px 20px;">
<div style="font-size:13px;line-height:18px;color:#7a4f17;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Your personal code</div>
<div style="padding:6px 0 8px 0;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:28px;line-height:36px;font-weight:700;letter-spacing:2px;color:#1f2937;">${escapeHtml(
      earlyBird.code
    )}</div>
<div style="font-size:15px;line-height:22px;color:#1f2937;"><strong>${
      earlyBird.percent
    }% off your first payment</strong> with this code.</div>
<div style="font-size:14px;line-height:20px;color:#7a4f17;padding-top:4px;">Expires ${expires}${left}.</div>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 0 8px 0;font-size:16px;line-height:24px;font-weight:700;">What Plus includes</td></tr>
<tr><td style="padding:0 0 16px 0;font-size:15px;line-height:24px;">
${includes
  .map(
    (line) =>
      `<div style="padding:2px 0;">&#10003;&nbsp; ${escapeHtml(line)}</div>`
  )
  .join('\n')}
</td></tr>
${
  monthly.savingPercent > 0
    ? `<tr><td style="padding:0 0 20px 0;font-size:15px;line-height:22px;">Plus is ${escapeHtml(
        price
      )} ${per}: <strong>${
        monthly.savingPercent
      }% cheaper than top-ups</strong>, where the same credits cost <span style="text-decoration:line-through;">${escapeHtml(
        topUpPrice
      )}</span>.</td></tr>`
    : ''
}
<tr><td style="padding:0 0 20px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#20808D" style="border-radius:8px;background-color:#20808D;padding:14px 28px;">
<a href="${url}" style="display:block;font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;">Get Plus with my code</a>
</td></tr></table>
</td></tr>
<tr><td style="font-size:14px;line-height:20px;color:#4b5563;">The code is already applied when you subscribe from Studio. This is the only extension: after it, the code stops working and this offer won't come back.</td></tr>
</table>`;
    return { subject, html };
  }
}
