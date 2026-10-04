'use client';

import { FC, ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { openTopUp } from '@gitroom/frontend/components/wallet/wallet.bridge';
import {
  BTN_PRIMARY,
  BTN_SIMPLE,
} from '@gitroom/frontend/components/wallet/wallet.ui';
import {
  TONE_SOFT,
  TONE_TEXT,
  WalletTone,
} from '@gitroom/frontend/components/wallet-locks/wallet.access';
import {
  CheckIcon,
  LockIcon,
  PlusIcon,
} from '@gitroom/frontend/components/wallet-locks/wallet.icons';

// A feature a wallet top-up opens. Locked (before the first top-up) it offers
// the top-up and the prices; open (`action` set) it shows the same page with
// one primary button, for a feature that is open but not set up yet. The
// tone follows how the feature is billed (teal for what a top-up opens).
export const LockedFeature: FC<{
  icon: ReactNode;
  title: string;
  body: string;
  eyebrow?: string;
  bullets?: string[];
  cta?: string;
  tone?: WalletTone;
  action?: { label: string; onClick: () => void };
  note?: string;
}> = ({
  icon,
  title,
  body,
  eyebrow,
  bullets,
  cta,
  tone = 'teal',
  action,
  note,
}) => {
  const t = useT();
  return (
    <div className="flex-1 bg-newBgColorInner flex items-center justify-center p-[40px] overflow-y-auto">
      <div className="max-w-[520px] flex flex-col items-center text-center gap-[14px]">
        <div className="relative w-[64px] h-[64px] rounded-full bg-newBgLineColor text-textItemBlur flex items-center justify-center">
          {icon}
          {!action && (
            <span
              className={clsx(
                'absolute -bottom-[2px] -end-[2px] w-[24px] h-[24px] rounded-full bg-newBgColorInner border border-newTableBorder flex items-center justify-center',
                TONE_TEXT[tone]
              )}
            >
              <LockIcon size={11} />
            </span>
          )}
        </div>
        {!!eyebrow && (
          <div
            className={clsx(
              'text-[12px] font-[600] uppercase tracking-[0.08em] mt-[6px]',
              TONE_TEXT[tone]
            )}
          >
            {eyebrow}
          </div>
        )}
        <h2
          className={clsx(
            'text-[22px] font-[600] leading-[1.3]',
            !eyebrow && 'mt-[6px]'
          )}
        >
          {title}
        </h2>
        <div className="text-[14px] text-textItemBlur leading-[1.55]">
          {body}
        </div>
        {!!bullets?.length && (
          <ul className="flex flex-col gap-[10px] text-start w-full max-w-[420px] mt-[4px]">
            {bullets.map((bullet) => (
              <li
                key={bullet}
                className="flex gap-[10px] items-start text-[14px] leading-[1.5]"
              >
                <span
                  className={clsx(
                    'mt-[2px] w-[20px] h-[20px] shrink-0 rounded-full flex items-center justify-center',
                    TONE_SOFT[tone],
                    TONE_TEXT[tone]
                  )}
                >
                  <CheckIcon size={12} />
                </span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap justify-center gap-[8px] mt-[8px]">
          {action ? (
            <button
              type="button"
              onClick={action.onClick}
              className={BTN_PRIMARY}
            >
              {action.label}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => openTopUp()}
                className={BTN_PRIMARY}
              >
                <PlusIcon />
                {cta || t('wallet_top_up', 'Top up')}
              </button>
              <Link href="/wallet/prices" className={BTN_SIMPLE}>
                {t('wallet_see_prices', 'See prices')}
              </Link>
            </>
          )}
        </div>
        {!!note && (
          <div className="text-[12px] text-textItemBlur -mt-[4px]">{note}</div>
        )}
      </div>
    </div>
  );
};
