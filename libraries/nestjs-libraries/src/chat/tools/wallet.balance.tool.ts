import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import dayjs from 'dayjs';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import {
  creditsText,
  notOnWalletMessage,
  onPaidPlan,
  orgFromContext,
  plusUrl,
  toCredits,
  topUpUrl,
  walletForecast,
} from '@gitroom/nestjs-libraries/chat/tools/wallet.shared';

@Injectable()
export class WalletBalanceTool implements AgentToolInterface {
  constructor(private _wallet: WalletService) {}
  name = 'walletBalance';

  run() {
    return createTool({
      id: 'walletBalance',
      description: `Returns the workspace's available wallet credits: the balance (split into Plus plan credits, which expire at the end of each plan period, and top-up credits, which stay), whether it has Plus or is on pay-as-you-go, whether the wallet is frozen, the auto top-up settings, and whether the paid usage scheduled in the coming hours is covered (the window is "forecast.windowHours").
Pay-per-use channels are paid from these credits when a post is scheduled (a draft is not charged): editing re-prices only what changed, and deleting a post, moving it back to draft or a post that fails to send gives its credits back. When the credits (with auto top-up) fall short of a post, it is not scheduled and the refusal carries the top-up link. The forecast is what is still to be paid in the coming hours: the next occurrence of a repeating post (each occurrence is paid as it goes out) and posts queued before charging moved to scheduling time; one of those whose credits are short when it is due does not go out.
walletTransactions lists the transaction history and walletPrices what things cost.`,
      inputSchema: z.object({}),
      mcp: {
        annotations: {
          title: 'Wallet Balance',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        usesWallet: z
          .boolean()
          .describe('False on a paid plan, which does not use credits'),
        message: z.string().optional(),
        balance: z.number().optional().describe('Credits, 2 decimals'),
        balanceText: z.string().optional(),
        payAsYouGo: z
          .boolean()
          .optional()
          .describe(
            'True while the paid features are open: with Plus, for a workspace that topped up before Plus launched (at any balance), or after a top-up while credit is left; false while frozen'
          ),
        plus: z.boolean().optional().describe('The workspace has Plus'),
        planCredits: z
          .number()
          .optional()
          .describe("Credits, 2 decimals: this plan period's Plus credits left, spent first"),
        planCreditsExpireAt: z
          .string()
          .nullable()
          .optional()
          .describe('When what is left of the plan credits expires'),
        topUpCredits: z
          .number()
          .optional()
          .describe('Credits, 2 decimals: top-up and other credits, which stay until spent'),
        plusUrl: z.string().optional(),
        frozen: z.boolean().optional(),
        autoTopUp: z
          .object({
            enabled: z.boolean(),
            belowCredits: z.number().nullable(),
            amount: z.string().nullable(),
            monthlyLimit: z.string().nullable(),
            usedThisMonth: z.string(),
            card: z.string().nullable(),
          })
          .optional(),
        forecast: z
          .object({
            windowHours: z.number(),
            neededCredits: z.number(),
            short: z.boolean(),
          })
          .nullable()
          .optional()
          .describe(
            'Paid usage scheduled in the coming hours; short means it is not covered by the balance and auto top-up'
          ),
        topUpUrl: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = orgFromContext(context);
        if (!org?.id) {
          return {
            usesWallet: false,
            error: 'Could not read the account behind this connection.',
          };
        }
        if (onPaidPlan(org)) {
          return { usesWallet: false, message: notOnWalletMessage };
        }

        try {
          // Read fresh: the organization in the context is a snapshot taken
          // when the request came in.
          const credits = await this._wallet.planCredits(org.id);
          const balance = credits.balance;
          const [wallet, access, forecast, spentAuto] =
            await Promise.all([
              this._wallet.getWallet(org.id),
              this._wallet.access(org.id),
              walletForecast(this._wallet, org.id),
              this._wallet.autoTopUpSpentSince(
                org.id,
                dayjs().startOf('month').toDate()
              ),
            ]);
          const frozen = !!(wallet as any)?.frozenAt;
          const money = (amount?: number | null) =>
            amount === null || amount === undefined
              ? Promise.resolve(null)
              : this._wallet.formatMoney(amount).catch(() => null);

          const [amount, monthlyLimit, usedThisMonth] = await Promise.all([
            money(wallet?.autoTopUpAmount),
            money(wallet?.autoTopUpMonthlyCap),
            money(spentAuto || 0),
          ]);

          const payAsYouGo = access.open;
          const short = !!forecast?.short;
          const message = frozen
            ? 'This wallet is frozen. Contact support to use it again.'
            : !payAsYouGo
            ? `This workspace is on the free plan. Plus opens X posting, research data and top-ups, with credits every month: ${plusUrl()}`
            : !access.topUpAllowed
            ? `This workspace's credits keep working until they are used up. Top-ups need Plus: ${plusUrl()}`
            : short
            ? `Scheduled usage in the next ${forecast!.windowHours} hours needs ${creditsText(
                forecast!.needed
              )}. You have ${creditsText(
                balance
              )}. Anything not covered won't go out. Top up: ${topUpUrl()}`
            : undefined;

          return {
            usesWallet: true,
            ...(message ? { message } : {}),
            balance: toCredits(balance),
            balanceText: creditsText(balance),
            payAsYouGo: payAsYouGo && !frozen,
            plus: access.plus,
            planCredits: toCredits(credits.plan),
            planCreditsExpireAt: credits.planResetsAt
              ? credits.planResetsAt.toISOString()
              : null,
            topUpCredits: toCredits(credits.topUp),
            frozen,
            autoTopUp: {
              enabled: !!wallet?.autoTopUp,
              belowCredits:
                wallet?.autoTopUpThreshold === null ||
                wallet?.autoTopUpThreshold === undefined
                  ? null
                  : toCredits(wallet.autoTopUpThreshold),
              amount,
              monthlyLimit,
              usedThisMonth: usedThisMonth || '0',
              card: wallet?.cardLast4
                ? `${wallet.cardBrand || 'card'} ending ${wallet.cardLast4}`
                : null,
            },
            forecast: forecast
              ? {
                  windowHours: forecast.windowHours,
                  neededCredits: toCredits(forecast.needed),
                  short,
                }
              : null,
            ...(short && access.topUpAllowed ? { topUpUrl: topUpUrl() } : {}),
            ...(!access.plus ? { plusUrl: plusUrl() } : {}),
          };
        } catch (err) {
          return {
            usesWallet: true,
            error: 'Could not read the wallet right now. Try again shortly.',
          };
        }
      },
    });
  }
}
