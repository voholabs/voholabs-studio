'use client';

import { FC, useCallback, useState } from 'react';
import copy from 'copy-to-clipboard';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { openPlus } from '@gitroom/frontend/components/wallet/wallet.bridge';
import { LockIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';
import {
  useUserFlowActions,
  UserFlowSource,
  UserFlowSummary,
  UserFlowsState,
} from '@gitroom/frontend/components/flows/flows.hooks';
import { flowCategoryLabel } from '@gitroom/frontend/components/flows/flows.card';
import { FlowEditor } from '@gitroom/frontend/components/flows/flows.editor';

type T = ReturnType<typeof useT>;

const sourceLabel = (t: T, source: UserFlowSource) => {
  switch (source) {
    case 'FORKED':
      return t('flows_mine_forked', 'From the library');
    case 'IMPORTED':
      return t('flows_mine_imported', 'Imported');
    case 'SAVED_FROM_CHAT':
      return t('flows_mine_from_chat', 'Saved from a chat');
    default:
      return t('flows_mine_created', 'Written here');
  }
};

// Opens the editor in a modal: a new flow (slug null) or one of mine.
export const useOpenFlowEditor = (onSaved: () => void) => {
  const modals = useModals();
  const t = useT();
  return useCallback(
    (slug: string | null) =>
      modals.openModal({
        title: slug
          ? t('flows_editor_edit', 'Edit flow')
          : t('flows_editor_new', 'New flow'),
        withCloseButton: true,
        children: (close: () => void) => (
          <FlowEditor
            slug={slug}
            onSaved={() => {
              onSaved();
              close();
            }}
          />
        ),
      }),
    [modals, t, onSaved]
  );
};

const ActionButton: FC<{
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}> = ({ label, onClick, danger, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`h-[28px] px-[10px] rounded-[6px] text-[12px] font-[600] border border-newTableBorder transition-colors disabled:opacity-50 ${
      danger
        ? 'text-textItemBlur hover:text-red-400 hover:border-red-400'
        : 'text-newTextColor hover:border-tealText'
    }`}
  >
    {label}
  </button>
);

const MyFlowCard: FC<{
  flow: UserFlowSummary;
  onEdit: (slug: string) => void;
  onChanged: () => void;
}> = ({ flow, onEdit, onChanged }) => {
  const t = useT();
  const toaster = useToaster();
  const actions = useUserFlowActions();
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    await work();
    setBusy(false);
  };

  const share = () =>
    run(async () => {
      const link = await actions.share(flow.slug);
      if (link) {
        copy(link.url);
        toaster.show(
          t(
            'flows_mine_link_copied',
            'Share link copied. Anyone signed in to Studio can import this flow.'
          ),
          'success'
        );
        onChanged();
      }
    });

  const unshare = () =>
    run(async () => {
      if (await actions.unshare(flow.slug)) {
        toaster.show(
          t('flows_mine_unshared', 'The share link is turned off.'),
          'success'
        );
        onChanged();
      }
    });

  const remove = () =>
    run(async () => {
      if (
        !(await deleteDialog(
          t(
            'flows_mine_delete_confirm',
            'Delete "{{title}}"? Its share link stops working too.',
            { title: flow.title }
          ),
          t('flows_mine_delete', 'Delete')
        ))
      ) {
        return;
      }
      if (await actions.remove(flow.slug)) {
        onChanged();
      }
    });

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
        {flow.shared && (
          <span className="inline-flex items-center h-[20px] px-[8px] rounded-full text-[11px] font-[600] bg-btnPrimary text-white">
            {t('flows_mine_shared', 'Shared')}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onEdit(flow.slug)}
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
          label={t('flows_mine_edit', 'Edit')}
          onClick={() => onEdit(flow.slug)}
          disabled={busy}
        />
        <ActionButton
          label={
            flow.shared
              ? t('flows_mine_copy_link', 'Copy link')
              : t('flows_mine_share', 'Share')
          }
          onClick={share}
          disabled={busy}
        />
        {flow.shared && (
          <ActionButton
            label={t('flows_mine_stop_sharing', 'Stop sharing')}
            onClick={unshare}
            disabled={busy}
          />
        )}
        <ActionButton
          label={t('flows_mine_delete', 'Delete')}
          onClick={remove}
          danger={true}
          disabled={busy}
        />
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
            'With Plus your agent runs every flow in the library, and you can save, fork and share your own.'
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
  onChanged: () => void;
}> = ({ state, onChanged }) => {
  const t = useT();
  const openEditor = useOpenFlowEditor(onChanged);
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
            onClick={() => openEditor(null)}
            className="h-[32px] px-[12px] rounded-[8px] text-[13px] font-[600] border border-newTableBorder hover:border-tealText"
          >
            {t('flows_mine_new', 'New flow')}
          </button>
        )}
      </div>
      {state.locked ? (
        <FlowsPlusLock />
      ) : !state.flows.length ? (
        <div className="text-[13px] leading-[1.5] text-textItemBlur">
          {t(
            'flows_mine_empty',
            'Nothing here yet. Fork a flow from the library below, write one, or ask your agent to "save this as a flow" after a run you liked.'
          )}
        </div>
      ) : (
        <div className="grid gap-[12px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">
          {state.flows.map((flow) => (
            <MyFlowCard
              key={flow.slug}
              flow={flow}
              onEdit={openEditor}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </section>
  );
};
