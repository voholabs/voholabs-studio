import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable, Logger } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  usageChargeKey,
  usageTopUpRequiredMessage,
  walletFrozenMessage,
  WalletService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { WalletBillingService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.billing.service';
import {
  creditsText,
  onPaidPlan,
  orgFromContext,
  plusUrl,
  toCredits,
  topUpUrl,
} from '@gitroom/nestjs-libraries/chat/tools/wallet.shared';

// Top-ups need Plus, so a workspace that cannot top up is sent to Plus.
export const notEnoughCreditsForUsageMessage = (
  name: string,
  units: number,
  topUpAllowed = true
) =>
  `Not enough credits for ${name.toLowerCase()} (${creditsText(units)}). ${
    topUpAllowed
      ? 'Top up your wallet, then try again.'
      : 'Get Plus to add credits, then try again.'
  }`;

// The lock a usage row gives a workspace without Plus, for the gateway.
const plusLock = () => ({
  locked: true as const,
  reason: 'plus' as const,
  upgradeUrl: plusUrl(),
  // Kept for callers that read the older field.
  topUpRequired: true,
});

// Charges work done outside Studio (the MCP gateway's image and voice
// generation) to the caller's wallet, by a price row charged by usage
// (WalletService.usageAction). Only served to the gateway (gatewayToolList),
// never listed to an agent. "quote" says before the work whether the
// workspace can pay; "charge" charges what was made, once per idempotency
// key; "rates" returns the live rates prices are worked out with. A paid plan
// is never charged and always gets the go-ahead.
@Injectable()
export class WalletUsageTool implements AgentToolInterface {
  private _logger = new Logger(WalletUsageTool.name);

  constructor(
    private _wallet: WalletService,
    private _billing: WalletBillingService
  ) {}
  name = 'walletUsage';

  run() {
    return createTool({
      id: 'walletUsage',
      description: `Quotes or charges usage-priced work (an AI image, a voice-over, a data run) to this workspace's wallet. "quote" returns the price, the balance, whether the workspace can pay and the live rates; "charge" charges what was made, once per idempotencyKey; "rates" returns the credits per currency unit and the default markup. A paid plan is not charged.`,
      inputSchema: z.object({
        action: z.enum(['quote', 'charge', 'rates']),
        actionKey: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe('The price row, e.g. "ai.image"; required for quote and charge'),
        units: z
          .number()
          .positive()
          .max(1000)
          .optional()
          .describe("Units of the row's unit: 1 image, 0.35 of 1k characters; required for quote and charge"),
        costUsd: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("What the provider reported for this use, in USD; without it (or 0), the row's cost"),
        idempotencyKey: z
          .string()
          .min(8)
          .max(200)
          .optional()
          .describe('Required for "charge": the same key is charged once'),
      }),
      mcp: {
        annotations: {
          title: 'Wallet Usage',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        ok: z.boolean(),
        paidPlan: z.boolean().optional(),
        price: z.number().optional().describe('Credits, 2 decimals'),
        charged: z.number().optional().describe('Credits, 2 decimals'),
        balance: z.number().optional().describe('Credits, 2 decimals'),
        status: z.number().optional(),
        wallet: z.boolean().optional(),
        frozen: z.boolean().optional(),
        locked: z
          .boolean()
          .optional()
          .describe('The row needs Plus and this workspace does not have it'),
        reason: z.literal('plus').optional(),
        upgradeUrl: z.string().optional().describe('The Plus page'),
        topUpRequired: z
          .boolean()
          .optional()
          .describe('Same as locked; kept for older callers'),
        rates: z
          .object({
            currency: z.string(),
            creditsPerUnit: z
              .number()
              .describe('Credits for one unit of the currency'),
            defaultMultiplier: z
              .number()
              .describe('Markup on provider cost'),
            defaultMultiplierBp: z.number(),
          })
          .optional(),
        url: z.string().optional(),
        message: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = orgFromContext(context);
        if (!org?.id) {
          return {
            ok: false,
            error: 'Could not read the account behind this connection.',
          };
        }
        if (onPaidPlan(org)) {
          return { ok: true, paidPlan: true, price: 0, charged: 0 };
        }
        // Never fails the call: without them the gateway keeps its own.
        const rates = await this._wallet.rates().catch(() => undefined);
        if (inputData.action === 'rates') {
          return rates
            ? { ok: true, rates }
            : { ok: false, error: 'The rates are not configured.' };
        }
        if (!inputData.actionKey || !inputData.units) {
          return { ok: false, error: 'quote and charge need actionKey and units.' };
        }
        const actionKey = inputData.actionKey;
        const units = inputData.units;

        try {
          if (inputData.action === 'quote') {
            const quote = await this._wallet.quoteUsage(org.id, actionKey, units);
            if (!quote) {
              return { ok: false, error: `No price for ${actionKey}` };
            }
            if (quote.frozen || quote.locked || quote.short) {
              const locked = quote.locked && !quote.frozen;
              const { topUpAllowed } = await this._wallet.access(org.id);
              return {
                ok: false,
                paidPlan: false,
                price: toCredits(quote.price),
                balance: toCredits(quote.balance),
                status: 402,
                wallet: true,
                frozen: !!quote.frozen,
                ...(locked ? plusLock() : {}),
                rates,
                url: locked || !topUpAllowed ? plusUrl() : topUpUrl(),
                message: quote.frozen
                  ? walletFrozenMessage()
                  : quote.locked
                  ? usageTopUpRequiredMessage(quote.action.name)
                  : notEnoughCreditsForUsageMessage(
                      quote.action.name,
                      quote.price,
                      topUpAllowed
                    ),
              };
            }
            return {
              ok: true,
              paidPlan: false,
              price: toCredits(quote.price),
              balance: toCredits(quote.balance),
              rates,
            };
          }

          if (!inputData.idempotencyKey) {
            return { ok: false, error: 'A charge needs an idempotencyKey.' };
          }
          const action = await this._wallet.usageAction(actionKey);
          if (!action) {
            return { ok: false, error: `No price for ${actionKey}` };
          }
          // Welcome credits never pay for a row that needs Plus; a frozen
          // wallet says so rather than asking for Plus
          if (await this._wallet.usageLocked(org.id, action)) {
            const frozen = await this._wallet.isFrozen(org.id);
            return {
              ok: false,
              paidPlan: false,
              status: 402,
              wallet: true,
              frozen,
              ...(frozen ? {} : plusLock()),
              url: frozen ? topUpUrl() : plusUrl(),
              message: frozen
                ? walletFrozenMessage()
                : usageTopUpRequiredMessage(action.name),
            };
          }
          // A reported cost is in USD; a row priced in another currency
          // keeps its own cost.
          const unitPrice = await this._wallet.usagePrice(
            action,
            units,
            inputData.costUsd !== undefined &&
              action.costCurrency.toUpperCase() === 'USD'
              ? inputData.costUsd * 1_000_000
              : undefined
          );
          // Auto top-up first when it can cover it, as storage does. The work
          // is already made, so the charge is never refused for the balance:
          // it may take the balance below zero.
          await this._billing
            .autoTopUpFor(org.id, unitPrice)
            .catch((): boolean => false);
          const entry = await this._billing.charge({
            organizationId: org.id,
            actionKey: action.key,
            chargeKey: usageChargeKey(
              org.id,
              action.key,
              inputData.idempotencyKey
            ),
            quantity: 1,
            unitPrice,
            allowNegative: true,
          });
          return {
            ok: true,
            paidPlan: false,
            charged: toCredits(-entry.amount),
            balance: toCredits(await this._wallet.balance(org.id)),
          };
        } catch (err) {
          this._logger.error(
            `walletUsage ${inputData.action} ${actionKey} for ${
              org.id
            } failed: ${err instanceof Error ? err.message : err}`
          );
          return {
            ok: false,
            error: 'Could not reach the wallet right now. Try again shortly.',
          };
        }
      },
    });
  }
}
