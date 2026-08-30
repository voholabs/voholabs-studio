'use client';

import { FC, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import {
  useCalendar,
  isFeedDisplay,
} from '@gitroom/frontend/components/launches/calendar.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/**
 * Picking one channel above the review and list feeds, so a batch scheduled
 * across four accounts can be read one account at a time instead of as one
 * interleaved stream.
 *
 * One channel at a time on purpose: the question this answers is "what is going
 * out on LinkedIn this week", and a single choice keeps the control to one click
 * in and one click out. The filter runs on the server, so it holds across pages.
 */
const ChannelChip: FC<{
  active: boolean;
  onClick: () => void;
  count: number;
  name: string;
  picture?: string;
  identifier?: string;
}> = ({ active, onClick, count, name, picture, identifier }) => (
  <div
    onClick={onClick}
    data-tooltip-id="tooltip"
    data-tooltip-content={name}
    className={clsx(
      'flex items-center gap-[8px] h-[34px] ps-[4px] pe-[12px] rounded-[999px] cursor-pointer border transition-all',
      active
        ? 'border-forth bg-boxFocused text-textItemFocused'
        : 'border-newTableBorder hover:bg-boxFocused'
    )}
  >
    <div className="relative min-w-[26px]">
      <img
        className="w-[26px] h-[26px] rounded-full object-cover"
        src={picture || '/no-picture.jpg'}
        alt={name}
      />
      {identifier && (
        <img
          className="w-[12px] h-[12px] rounded-full absolute -bottom-[1px] -end-[1px] border border-fifth"
          src={`/icons/platforms/${identifier}.png`}
          alt={identifier}
        />
      )}
    </div>
    <div className="text-[13px] font-[500] max-w-[120px] truncate">{name}</div>
    <div className="text-[12px] opacity-60 tabular-nums">{count}</div>
  </div>
);

export const AccountFilter = () => {
  const t = useT();
  const {
    display,
    integrations,
    listCounts,
    listChannelCounts,
    listIntegration,
    setListIntegration,
  } = useCalendar();

  // A channel earns a chip by having something in the current feed - otherwise
  // an account with nothing scheduled is a dead button. The selected one stays
  // whatever its count, so the way back to "all" never disappears.
  //
  // Membership is decided ignoring the review state, and only the number below
  // follows it: a chip that disappeared because you asked for "Reviewed" would
  // take the whole row with it once fewer than two channels were left, and the
  // way back out with it. A channel with none shows a zero and stays put.
  const channels = useMemo(
    () =>
      integrations
        .filter(
          (integration) =>
            (listChannelCounts[integration.id] || 0) > 0 ||
            integration.id === listIntegration
        )
        .sort(
          (a, b) =>
            (listChannelCounts[b.id] || 0) - (listChannelCounts[a.id] || 0)
        ),
    [integrations, listChannelCounts, listIntegration]
  );

  const total = useMemo(
    () =>
      channels.reduce(
        (sum, integration) => sum + (listCounts[integration.id] || 0),
        0
      ),
    [channels, listCounts]
  );

  const select = useCallback(
    (id: string | null) => () => {
      setListIntegration(listIntegration === id ? null : id);
    },
    [listIntegration, setListIntegration]
  );

  // Nothing to separate with one channel, and nothing to filter with none.
  if (!isFeedDisplay(display) || channels.length < 2) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-[8px] text-textColor select-none">
      <div
        onClick={select(null)}
        className={clsx(
          'flex items-center gap-[8px] h-[34px] px-[14px] rounded-[999px] cursor-pointer border transition-all text-[13px] font-[500]',
          !listIntegration
            ? 'border-forth bg-boxFocused text-textItemFocused'
            : 'border-newTableBorder hover:bg-boxFocused'
        )}
      >
        {t('all_accounts', 'All accounts')}
        <span className="text-[12px] opacity-60 tabular-nums">{total}</span>
      </div>
      {channels.map((integration) => (
        <ChannelChip
          key={integration.id}
          active={listIntegration === integration.id}
          onClick={select(integration.id)}
          count={listCounts[integration.id] || 0}
          name={integration.name}
          picture={integration.picture}
          identifier={integration.identifier}
        />
      ))}
    </div>
  );
};
