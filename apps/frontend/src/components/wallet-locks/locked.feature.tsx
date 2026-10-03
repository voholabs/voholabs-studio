'use client';

import { FC, ReactNode } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { openTopUp } from '@gitroom/frontend/components/wallet/wallet.bridge';
import {
  CheckIcon,
  LockIcon,
  PlusIcon,
} from '@gitroom/frontend/components/wallet-locks/wallet.icons';

export const BTN_PRIMARY =
  'text-white bg-btnPrimary hover:brightness-110 h-[44px] px-[20px] rounded-[8px] text-[15px] font-[600] flex items-center justify-center gap-[8px] transition disabled:opacity-50 disabled:cursor-not-allowed';
export const BTN_SIMPLE =
  'text-btnText bg-btnSimple hover:brightness-125 h-[44px] px-[20px] rounded-[8px] text-[15px] font-[600] flex items-center justify-center gap-[8px] transition';

// A feature a wallet top-up opens, seen before the first top-up. Teal, because
// opening it is a one-time unlock rather than pay-per-use.
export const LockedFeature: FC<{
  icon: ReactNode;
  title: string;
  body: string;
  eyebrow?: string;
  bullets?: string[];
  cta?: string;
}> = ({ icon, title, body, eyebrow, bullets, cta }) => {
  const t = useT();
  return (
    <div className="flex-1 bg-newBgColorInner flex items-center justify-center p-[40px] overflow-y-auto">
      <div className="max-w-[520px] flex flex-col items-center text-center gap-[14px]">
        <div className="relative w-[64px] h-[64px] rounded-full bg-newBgLineColor text-textItemBlur flex items-center justify-center">
          {icon}
          <span className="absolute -bottom-[2px] -end-[2px] w-[24px] h-[24px] rounded-full bg-newBgColorInner border border-newTableBorder text-tealText flex items-center justify-center">
            <LockIcon size={11} />
          </span>
        </div>
        {!!eyebrow && (
          <div className="text-[12px] font-[600] uppercase tracking-[0.08em] text-tealText mt-[6px]">
            {eyebrow}
          </div>
        )}
        <h2
          className={`text-[22px] font-[600] leading-[1.3] ${
            eyebrow ? '' : 'mt-[6px]'
          }`}
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
                <span className="mt-[2px] w-[20px] h-[20px] shrink-0 rounded-full bg-tealSoft text-tealText flex items-center justify-center">
                  <CheckIcon size={12} />
                </span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap justify-center gap-[8px] mt-[8px]">
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
        </div>
      </div>
    </div>
  );
};
