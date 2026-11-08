'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { openPlus } from '@gitroom/frontend/components/wallet/wallet.bridge';
import { LockIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';
import {
  Flow,
  UserFlowSummary,
  UserFlowsState,
} from '@gitroom/frontend/components/flows/flows.hooks';
import { flowCategoryLabel } from '@gitroom/frontend/components/flows/flows.card';
import {
  ActionButton,
  findBase,
  MyFlowActionButtons,
  sourceLabel,
  useOpenFlowView,
} from '@gitroom/frontend/components/flows/flows.view';
import { useOpenNewCustomFlow } from '@gitroom/frontend/components/flows/flows.new';

const MyFlowCard: FC<{
  flow: UserFlowSummary;
  // The title of the flow it is based on, for a custom flow.
  baseTitle?: string;
  onOpen: (slug: string) => void;
  onChanged: () => void;
}> = ({ flow, baseTitle, onOpen, onChanged }) => {
  const t = useT();

  return (
    <div className="flex flex-col gap-[10px] rounded-[12px] border border-newTableBorder bg-newTableHeader p-[14px] min-w-0">
      <div className="flex items-center gap-[6px] flex-wrap">
        {!!flow.category && (
          <span className="inline-flex items-center h-[20px] px-[8px] rounded-full text-[11px] font-[600] bg-tealSoft text-tealText">
            {flowCategoryLabel(t, flow.category)}
          </span>
        )}
        <span className="inline-flex items-center h-[20px] px-[8px] rounded-full text-[11px] font-[600] border border-newTableBorder text-textItemBlur">
          {sourceLabel(t, flow.source)}
        </span>
        {!!flow.basedOn && (
          <span className="inline-flex items-center h-[20px] px-[8px] rounded-full text-[11px] font-[600] border border-newTableBorder text-textItemBlur max-w-full min-w-0">
            <span className="truncate">
              {t('flows_mine_based_on', 'Based on {{title}}', {
                title: baseTitle || flow.basedOn,
              })}
            </span>
          </span>
        )}
        {flow.shared && (
          <span className="inline-flex items-center h-[20px] px-[8px] rounded-full text-[11px] font-[600] bg-btnPrimary text-white">
            {t('flows_mine_shared', 'Shared')}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onOpen(flow.slug)}
        className="text-start text-[15px] font-[700] leading-[1.25] line-clamp-2 hover:underline"
      >
        {flow.title}
      </button>
      {!!(flow.summary || flow.whenToUse) && (
        <div className="text-[13px] leading-[1.4] text-textItemBlur line-clamp-2">
          {flow.summary || flow.whenToUse}
        </div>
      )}
      <div className="text-[12px] text-textItemBlur font-mono">
        my/{flow.slug}
      </div>
      <div className="flex items-center gap-[6px] flex-wrap mt-auto">
        <ActionButton
          label={t('flows_mine_open', 'Open')}
          onClick={() => onOpen(flow.slug)}
        />
        <MyFlowActionButtons flow={flow} onChanged={onChanged} />
      </div>
    </div>
  );
};

// Flows open with Plus: the library stays visible, My flows says what Plus
// opens and links to it.
export const FlowsPlusLock: FC = () => {
  const t = useT();
  return (
    <div className="flex items-start gap-[10px] rounded-[10px] px-[14px] py-[12px] bg-warmSoft text-[13px] leading-[1.5]">
      <span className="text-warm mt-[3px] shrink-0">
        <LockIcon size={14} />
      </span>
      <div className="flex flex-col gap-[4px]">
        <div className="font-[600] text-warm">
          {t('flows_plus_locked', 'Flows are included with Plus')}
        </div>
        <div className="text-textItemBlur">
          {t(
            'flows_plus_locked_body',
            'With Plus your agent runs every flow in the library, and you can save, customize and share your own.'
          )}
        </div>
        <button
          type="button"
          onClick={() => openPlus()}
          className="self-start text-warm font-[600] hover:underline"
        >
          {t('plus_get', 'Get Plus')}
        </button>
      </div>
    </div>
  );
};

// "My flows", above the Voho library.
export const MyFlowsSection: FC<{
  state?: UserFlowsState;
  // The Voho library, for the titles of the flows custom flows are based on.
  library?: Flow[];
  onChanged: () => void;
  // Show only the first few (Home); the rest are on the Flows page.
  limit?: number;
}> = ({ state, library, onChanged, limit }) => {
  const t = useT();
  const openView = useOpenFlowView(onChanged);
  const openNew = useOpenNewCustomFlow();
  if (!state) {
    return null;
  }
  return (
    <section className="flex flex-col gap-[12px]">
      <div className="flex items-center gap-[12px]">
        <h2 className="flex-1 text-[18px] font-[700]">
          {t('flows_mine_title', 'My flows')}
        </h2>
        {!state.locked && (
          <button
            type="button"
            onClick={() => openNew()}
            className="h-[32px] px-[12px] rounded-[8px] text-[13px] font-[600] border border-newTableBorder hover:border-tealText"
          >
            {t('flows_mine_new', 'New custom flow')}
          </button>
        )}
      </div>
      {state.locked ? (
        <FlowsPlusLock />
      ) : !state.flows.length ? (
        <div className="text-[13px] leading-[1.5] text-textItemBlur">
          {t(
            'flows_mine_empty',
            'Nothing here yet. Customize a flow from the library below, have your agent make one, or ask it to "save this as a flow" after a run you liked.'
          )}
        </div>
      ) : (
        <div className="grid gap-[12px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">
          {state.flows.slice(0, limit).map((flow) => (
            <MyFlowCard
              key={flow.slug}
              flow={flow}
              baseTitle={
                findBase(flow.basedOn, library, state.flows)?.title
              }
              onOpen={openView}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </section>
  );
};
