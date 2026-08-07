'use client';

import { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { BrainSaveState } from '@gitroom/frontend/components/agent-brain/use.brain.autosave';

export const BrainSaveIndicator: FC<{
  state: BrainSaveState;
  onRetry: () => void;
}> = ({ state, onRetry }) => {
  const t = useT();

  if (state === 'idle' || state === 'dirty') {
    return null;
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-[8px] text-[12px] text-red-400">
        <span>{t('brain_save_failed', 'Could not save')}</span>
        <span onClick={onRetry} className="underline cursor-pointer">
          {t('brain_save_retry', 'Retry')}
        </span>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'flex items-center gap-[6px] text-[12px] text-textItemBlur transition-opacity'
      )}
    >
      {state === 'saving' ? (
        t('brain_saving', 'Saving...')
      ) : (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M13.3333 4L6 11.3333L2.66667 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('brain_saved', 'Saved')}
        </>
      )}
    </div>
  );
};
