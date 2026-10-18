import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import {
  checkAuth,
  paidOnly,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  BRIEF_ONBOARDING_ACTION,
  BriefOnboardingService,
} from '@gitroom/nestjs-libraries/database/prisma/brief/brief.onboarding.service';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import {
  creditsText,
  orgFromContext,
} from '@gitroom/nestjs-libraries/chat/tools/wallet.shared';

// Studio's Brief page. While the brief is empty it shows the brief interview
// prompt for the user's own agent (the same as onboarding's teach step); it
// no longer opens the guided run.
export const briefOnboardingPageUrl = () =>
  `${process.env.FRONTEND_URL}/brief`;

@Injectable()
export class BriefOnboardingStatusTool implements AgentToolInterface {
  constructor(
    private _onboarding: BriefOnboardingService,
    private _wallet: WalletService
  ) {}
  name = 'briefOnboardingStatus';

  run() {
    return createTool({
      id: 'briefOnboardingStatus',
      description: `Whether the guided brief onboarding is available, running, or has run before.
The guided onboarding was an interview that wrote the agent brief in one sitting; Studio no longer starts new runs from its pages. "startUrl" is Studio's Brief page, which for an empty brief shows the brief interview prompt the user pastes into their own agent (the interview itself is briefLearnTool) and lists which brief documents are filled. "nextRunCharged" and "price" describe what a run would take from the wallet.
Writing the brief directly is briefSaveTool.`,
      mcp: {
        annotations: {
          title: 'Brief Onboarding Status',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        available: z
          .boolean()
          .optional()
          .describe('False when this instance has no onboarding configured'),
        running: z
          .object({ id: z.string(), startedAt: z.string() })
          .nullable()
          .optional()
          .describe('A run that is open now; the user can reopen it for free'),
        last: z
          .object({
            id: z.string(),
            status: z.string(),
            finishedAt: z.string().nullable(),
            error: z.string().nullable(),
          })
          .nullable()
          .optional(),
        nextRunCharged: z.boolean().optional(),
        price: z
          .string()
          .optional()
          .describe('What a new run takes from the wallet, when it is charged'),
        startUrl: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const blocked = paidOnly(context, 'The agent brief', 'brief');
        if (blocked) {
          return { error: blocked };
        }
        const organization = orgFromContext(context);
        if (!organization?.id) {
          return { error: 'Could not read the account behind this connection.' };
        }
        try {
          const status = await this._onboarding.status(organization.id);
          const priced = status.nextRunCharged
            ? await this._wallet
                .price(BRIEF_ONBOARDING_ACTION)
                .catch((): undefined => undefined)
            : undefined;
          const iso = (value?: Date | string | null) =>
            value ? new Date(value).toISOString() : null;
          return {
            available: status.available,
            running: status.running
              ? {
                  id: status.running.id,
                  startedAt: iso(status.running.createdAt) as string,
                }
              : null,
            last: status.last
              ? {
                  id: status.last.id,
                  status: String(status.last.status),
                  finishedAt: iso(status.last.finishedAt),
                  error: status.last.error || null,
                }
              : null,
            nextRunCharged: status.nextRunCharged,
            ...(priced ? { price: creditsText(priced.price) } : {}),
            ...(status.available ? { startUrl: briefOnboardingPageUrl() } : {}),
          };
        } catch (err) {
          return {
            error:
              'Could not read the onboarding status right now. Try again shortly.',
          };
        }
      },
    });
  }
}
