import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import {
  creditsText,
  onPaidPlan,
  toCredits,
} from '@gitroom/nestjs-libraries/chat/tools/wallet.shared';

// The plan behind the account and whether its usage is metered in credits.
// A paid plan never touches the wallet; Plus and the free plan carry the
// balance. Never throws: a wallet that cannot be read leaves the credits out.
const planInfo = async (wallet: WalletService, organization: any) => {
  if (onPaidPlan(organization)) {
    return {
      plan: 'paid' as const,
      creditsMetered: false,
      credits: 'Not metered on this plan',
    };
  }
  try {
    const [credits, access] = await Promise.all([
      wallet.planCredits(organization.id),
      wallet.access(organization.id),
    ]);
    return {
      plan: access.plus
        ? ('plus' as const)
        : access.legacy
        ? ('payg' as const)
        : ('free' as const),
      creditsMetered: true,
      credits: access.plus
        ? `${creditsText(credits.balance)} (${toCredits(credits.plan).toFixed(
            2
          )} Plus plan credits, ${toCredits(credits.topUp).toFixed(
            2
          )} top-up credits)`
        : creditsText(credits.balance),
      balance: toCredits(credits.balance),
      planCredits: toCredits(credits.plan),
      topUpCredits: toCredits(credits.topUp),
    };
  } catch (err) {
    return { creditsMetered: true };
  }
};

@Injectable()
export class AccountInfoTool implements AgentToolInterface {
  constructor(private _wallet: WalletService) {}
  name = 'accountInfo';

  run() {
    return createTool({
      id: 'accountInfo',
      description: `Says which account this connection belongs to: the organization (also called the team or workspace), the instance it lives on, and its plan: a paid plan, whose usage is not metered in credits, Plus, pay-as-you-go from before Plus or the free plan, with the credits it has when they are metered.
It answers what the connection is linked to, which account or team is in use, and whether this is the live site or a test one, which identifies the account that anything published or deleted through this connection affects.
This is the account itself, which is different from the customers returned by groupList — those are optional labels for grouping channels.`,
      inputSchema: z.object({}),
      mcp: {
        annotations: {
          title: 'Account Info',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        id: z.string().describe('The organization id'),
        name: z.string().describe('The organization (team) name'),
        instance: z
          .string()
          .optional()
          .describe(
            'The site this account lives on, which distinguishes the live instance from a test one'
          ),
        plan: z
          .enum(['paid', 'plus', 'payg', 'free'])
          .optional()
          .describe(
            'The plan: "paid" (a subscription, trial or granted access; usage not metered in credits), "plus", "payg" (pay-as-you-go from before Plus: top-ups and the paid features open without Plus), or "free" (no Plus; any credits left still work)'
          ),
        creditsMetered: z
          .boolean()
          .optional()
          .describe('Whether usage on this plan is paid from wallet credits'),
        credits: z
          .string()
          .optional()
          .describe('The credits in words: the balance, or that this plan does not meter them'),
        balance: z.number().optional().describe('Credits, 2 decimals'),
        planCredits: z
          .number()
          .optional()
          .describe("Credits, 2 decimals: this plan period's Plus credits left"),
        topUpCredits: z
          .number()
          .optional()
          .describe('Credits, 2 decimals: top-up and other credits, which stay until spent'),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organization = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          );

          return {
            id: organization.id,
            name: organization.name,
            instance: process.env.FRONTEND_URL,
            ...(await planInfo(this._wallet, organization)),
          };
        } catch (err) {
          return {
            id: '',
            name: '',
            error: 'Could not read the account behind this connection.',
          };
        }
      },
    });
  }
}
