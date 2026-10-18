'use client';

import { FC, useCallback, useState } from 'react';
import copy from 'copy-to-clipboard';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useAgentConnection } from '@gitroom/frontend/components/public-api/agent.connection.status';
import { useBriefPrompt } from '@gitroom/frontend/components/agent-brief/brief.prompt';
import { OnboardingStatus } from '@gitroom/frontend/components/onboarding/use.onboarding.status';

export const StepCheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

// The title above the teach steps, the same in both places.
export const OnboardingTeachHeading: FC = () => {
  const t = useT();
  return (
    <div className="flex gap-[4px] flex-col text-center">
      <div className="text-[24px] font-semibold">
        {t('onboarding_teach_title', 'Teach your agent your business')}
      </div>
      <div className="text-[14px] text-textItemBlur">
        {t(
          'onboarding_teach_sub',
          "Your agent learns what you sell, who you're for and how you sound, so every post sounds like you. It does the work; you just confirm. Free, about 5 minutes."
        )}
      </div>
    </div>
  );
};

// Teach your agent: one prompt to paste into the connected agent. It runs the
// interview, answers what it can and asks only for the rest; the documents
// tick off here as it saves them. Onboarding's third step, and the Brief page
// while the brief is still empty (someone who skipped that step).
export const OnboardingTeach: FC<{
  status?: OnboardingStatus;
  connection: ReturnType<typeof useAgentConnection>['data'];
}> = ({ status, connection }) => {
  const t = useT();
  // ChatGPT runs plugins in Work only, so its users are told where to paste.
  const chatgpt =
    !!connection?.connected &&
    (connection.clients || [connection.client]).includes('chatgpt');
  const [copied, setCopied] = useState(false);
  const documents = status?.brief?.documents || [];
  const filled = documents.filter((document) => document.filled).length;
  const prompt = useBriefPrompt();

  const copyPrompt = useCallback(() => {
    copy(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prompt]);

  const numbered = (index: number, text: string) => (
    <div className="flex items-start gap-[10px] text-[14px]">
      <span className="shrink-0 w-[22px] h-[22px] rounded-full border border-newBorder text-textItemBlur flex items-center justify-center text-[12px] font-[700]">
        {index}
      </span>
      <span className="pt-[1px]">{text}</span>
    </div>
  );

  return (
    <>
      <div className="flex flex-col gap-[12px]">
        {numbered(1, t('onboarding_brief_step_copy', 'Copy this prompt'))}
        <div className="flex flex-col sm:flex-row gap-[12px] sm:items-start bg-newBgColor border border-newBorder rounded-[12px] p-[14px]">
          <div className="flex-1 text-[13px] leading-[1.5] text-textItemBlur select-all">
            {prompt}
          </div>
          <button
            type="button"
            onClick={copyPrompt}
            className="shrink-0 h-[40px] px-[18px] rounded-[10px] bg-btnPrimary hover:brightness-110 text-white text-[14px] font-[600] transition-all"
          >
            {copied
              ? t('onboarding_brief_copied', 'Copied')
              : t('onboarding_brief_copy', 'Copy prompt')}
          </button>
        </div>
        {numbered(
          2,
          chatgpt
            ? t(
                'onboarding_brief_step_paste_chatgpt',
                'Paste it into ChatGPT, in Work (not Chat)'
              )
            : t(
                'onboarding_brief_step_paste',
                'Paste it into the agent you just connected'
              )
        )}
        {numbered(
          3,
          t(
            'onboarding_brief_step_answer_files',
            "Confirm or correct the little it can't find by itself, and send it any brand files you have (logo, brand guide, product photos)"
          )
        )}
      </div>

      <div className="flex flex-col gap-[10px]">
        <div className="flex items-center justify-between text-[14px] font-[600]">
          <span>{t('onboarding_teach_progress', 'What your agent knows')}</span>
          <span className="text-textItemBlur font-[500]">
            {filled} / {documents.length}
          </span>
        </div>
        <div className="text-[13px] text-textItemBlur">
          {t(
            'onboarding_teach_wait',
            'Your agent will spend a few minutes researching your business. Keep this page open; each item ticks off as it saves.'
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[8px]">
          {documents.map((document) => (
            <div
              key={document.key}
              className="flex items-center gap-[10px] rounded-[10px] border border-newBorder px-[12px] py-[10px] text-[14px]"
            >
              <span
                className={clsx(
                  'shrink-0 w-[22px] h-[22px] rounded-full flex items-center justify-center',
                  document.filled
                    ? 'bg-btnPrimary text-white'
                    : 'border border-newBorder'
                )}
              >
                {document.filled && <StepCheckIcon />}
              </span>
              <span
                className={
                  document.filled ? 'text-newTextColor' : 'text-textItemBlur'
                }
              >
                {document.label}
              </span>
            </div>
          ))}
        </div>
        <div className="text-[13px] text-textItemBlur">
          {t(
            'onboarding_teach_saved_agent',
            'Saved as your Brief. Edit it any time from the Brief tab or tell your agent to update it.'
          )}
        </div>
      </div>
    </>
  );
};
