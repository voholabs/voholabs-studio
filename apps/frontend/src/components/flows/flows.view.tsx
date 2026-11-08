'use client';

import { FC, useCallback, useState } from 'react';
import copy from 'copy-to-clipboard';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  Flow,
  useFlows,
  useUserFlow,
  useUserFlowActions,
  useUserFlows,
  UserFlowSaved,
  UserFlowSource,
  UserFlowSummary,
} from '@gitroom/frontend/components/flows/flows.hooks';
import { flowCategoryLabel } from '@gitroom/frontend/components/flows/flows.card';
import { useCopyPrompt } from '@gitroom/frontend/components/flows/flows.drawer';
import { USER_FLOW_TITLE_MAX } from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

type T = ReturnType<typeof useT>;

const INPUT =
  'w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] text-[14px] outline-none focus:border-tealText transition-colors';

const KICKER =
  'text-[12px] font-[500] uppercase tracking-[0.08em] text-textItemBlur';

const TEXT_BOX =
  'rounded-[8px] bg-newBgColor p-[14px] font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words';

// The prompt that asks the user's agent to change one of My flows, with the
// flow's slug as the information it is based on. The text goes to the agent
// as written, so it is not translated.
export const editFlowPrompt = (
  flow: { title: string; slug: string },
  change: string
) =>
  `Update my flow "${flow.title}" using Voholabs Studio: ${
    change.trim().replace(/[.\s]+$/, '') || 'the change I describe below'
  }. Keep the rest as it is, show me the change, then save it. Based on the following information:\nMy flow: my/${
    flow.slug
  }`;

// The flow a custom flow is based on: a Voho library flow by id or one of
// My flows ("my/<slug>"). Undefined while the lists load or when it is gone.
export const findBase = (
  basedOn: string | null | undefined,
  library: Flow[] | undefined,
  mine: UserFlowSummary[] | undefined
): { title: string; summary: string } | undefined => {
  if (!basedOn) {
    return undefined;
  }
  return basedOn.startsWith('my/')
    ? mine?.find((one) => one.slug === basedOn.slice(3))
    : library?.find((one) => one.id === basedOn);
};

// The brand-content notes a save returns: the flow is saved either way.
export const useShowFlowWarnings = () => {
  const toaster = useToaster();
  const t = useT();
  return (saved: UserFlowSaved) => {
    toaster.show(
      saved.warnings.length
        ? `${t('flows_mine_saved_with_notes', 'Saved. Note:')} ${saved.warnings.join(' ')}`
        : t('flows_mine_saved', 'Saved to My flows.'),
      saved.warnings.length ? 'warning' : 'success'
    );
  };
};

export const sourceLabel = (t: T, source: UserFlowSource) => {
  switch (source) {
    case 'FORKED':
      return t('flows_mine_forked', 'From the library');
    case 'IMPORTED':
      return t('flows_mine_imported', 'Imported');
    case 'SAVED_FROM_CHAT':
      return t('flows_mine_from_chat', 'Saved from a chat');
    case 'LEARNED':
      return t('flows_mine_learned', 'Learned from videos');
    default:
      return t('flows_mine_created', 'Written here');
  }
};

export const ActionButton: FC<{
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

// Share, stop sharing and delete one of My flows, from its card or its
// view. Each resolves to whether it went through.
export const useMyFlowActions = (
  flow: { slug: string; title: string },
  onChanged: () => void
) => {
  const t = useT();
  const toaster = useToaster();
  const actions = useUserFlowActions();
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<boolean>) => {
    setBusy(true);
    const done = await work();
    setBusy(false);
    return done;
  };

  const share = () =>
    run(async () => {
      const link = await actions.share(flow.slug);
      if (!link) {
        return false;
      }
      copy(link.url);
      toaster.show(
        t(
          'flows_mine_link_copied',
          'Share link copied. Anyone signed in to Studio can import this flow.'
        ),
        'success'
      );
      onChanged();
      return true;
    });

  const unshare = () =>
    run(async () => {
      if (!(await actions.unshare(flow.slug))) {
        return false;
      }
      toaster.show(
        t('flows_mine_unshared', 'The share link is turned off.'),
        'success'
      );
      onChanged();
      return true;
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
        return false;
      }
      if (!(await actions.remove(flow.slug))) {
        return false;
      }
      onChanged();
      return true;
    });

  return { busy, share, unshare, remove };
};

// The flow a custom flow is based on, read only: its method is not copied
// into the custom flow.
export const FlowBaseCard: FC<{ basedOn: string }> = ({ basedOn }) => {
  const t = useT();
  const { data: library } = useFlows();
  const { data: mine } = useUserFlows();
  const base = findBase(basedOn, library, mine?.flows);
  const loading = !library || !mine;
  return (
    <div className="flex flex-col gap-[4px] rounded-[10px] border border-newTableBorder bg-newTableHeader px-[14px] py-[12px]">
      <div className={KICKER}>
        {basedOn.startsWith('my/')
          ? t('flows_editor_base_mine', 'Based on one of My flows')
          : t('flows_editor_base_library', 'Based on a Voho library flow')}
      </div>
      <div className="text-[15px] font-[700] leading-[1.3] break-words">
        {base?.title || basedOn}
      </div>
      {base
        ? !!base.summary && (
            <div className="text-[13px] leading-[1.5] text-textItemBlur line-clamp-3">
              {base.summary}
            </div>
          )
        : !loading && (
            <div className="text-[13px] leading-[1.5] text-warm">
              {t(
                'flows_editor_base_gone',
                'This flow is no longer available. Your customization is kept.'
              )}
            </div>
          )}
    </div>
  );
};

// A flow's method as written, read only: what a custom flow changes in its
// base, the method of a flow of its own, and its named parts. The flow view
// and the shared page show it the same way.
export const FlowMethod: FC<{
  customization: string;
  body: string;
  parts: Record<string, string> | null;
  // A flow based on another: the method is its customization.
  based: boolean;
}> = ({ customization, body, parts, based }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[8px]">
      {!!customization && (
        <>
          <div className={KICKER}>
            {t('flows_editor_customization', 'Customization')}
          </div>
          <div dir="auto" className={TEXT_BOX}>
            {customization}
          </div>
        </>
      )}
      {(!!body || !based) && (
        <>
          <div className={KICKER}>{t('flows_shared_method', 'The method')}</div>
          <div dir="auto" className={TEXT_BOX}>
            {body}
          </div>
        </>
      )}
      {Object.entries(parts || {}).map(([name, text]) => (
        <details key={name} className="rounded-[8px] border border-newTableBorder">
          <summary className="cursor-pointer select-none px-[12px] h-[38px] flex items-center text-[13px] font-[600]">
            {name}
          </summary>
          <div
            dir="auto"
            className="mx-[12px] mb-[12px] rounded-[6px] bg-newBgColor p-[12px] font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words"
          >
            {text}
          </div>
        </details>
      ))}
    </div>
  );
};

// The title, with Rename: the one edit made in the app. Everything else is
// changed by the workspace's agent.
const FlowTitle: FC<{
  slug: string;
  title: string;
  onRenamed: () => void;
}> = ({ slug, title, onRenamed }) => {
  const t = useT();
  const actions = useUserFlowActions();
  const showWarnings = useShowFlowWarnings();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = value.trim();
    if (!next || saving) {
      return;
    }
    if (next === title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const saved = await actions.update(slug, { title: next });
    setSaving(false);
    if (saved) {
      showWarnings(saved);
      setEditing(false);
      onRenamed();
    }
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-[10px]">
        <h2 className="flex-1 min-w-0 text-[22px] font-[700] leading-[1.25] break-words">
          {title}
        </h2>
        <ActionButton
          label={t('flows_view_rename', 'Rename')}
          onClick={() => {
            setValue(title);
            setEditing(true);
          }}
        />
      </div>
    );
  }
  return (
    <form
      className="flex items-center gap-[8px]"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={USER_FLOW_TITLE_MAX}
        aria-label={t('flows_editor_title', 'Title')}
        autoFocus={true}
        className={`${INPUT} h-[40px] flex-1 min-w-0`}
      />
      <button
        type="submit"
        disabled={!value.trim() || saving}
        className="h-[40px] px-[16px] rounded-[8px] bg-btnPrimary hover:brightness-110 text-white text-[14px] font-[600] disabled:opacity-50 transition-all"
      >
        {saving
          ? t('flows_editor_saving', 'Saving...')
          : t('flows_view_rename_save', 'Save')}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="h-[40px] px-[12px] rounded-[8px] text-[14px] font-[600] border border-newTableBorder hover:border-tealText"
      >
        {t('cancel', 'Cancel')}
      </button>
    </form>
  );
};

// "Edit with your agent": the prompt that asks the agent to change this
// flow, with what to change when the user says it here.
const EditWithAgent: FC<{ slug: string; title: string }> = ({
  slug,
  title,
}) => {
  const t = useT();
  const [change, setChange] = useState('');
  const { copyPrompt } = useCopyPrompt(
    editFlowPrompt({ slug, title }, change)
  );
  return (
    <div className="flex flex-col gap-[8px] rounded-[10px] border border-newTableBorder p-[14px]">
      <div className="text-[13px] font-[600]">
        {t('flows_view_edit_with_agent', 'Edit with your agent')}
      </div>
      <input
        value={change}
        onChange={(event) => setChange(event.target.value)}
        maxLength={300}
        placeholder={t(
          'flows_view_change_placeholder',
          'What to change, e.g. "make the hook shorter" (optional)'
        )}
        aria-label={t('flows_view_change', 'What to change')}
        className={`${INPUT} h-[40px]`}
      />
      <button
        type="button"
        onClick={copyPrompt}
        className="self-start h-[40px] px-[18px] rounded-[8px] bg-btnPrimary hover:brightness-110 text-white text-[14px] font-[600] transition-all"
      >
        {t('flows_copy_prompt', 'Copy prompt')}
      </button>
      <div className="text-[12px] leading-[1.5] text-textItemBlur">
        {t(
          'flows_view_edit_hint',
          'Paste it into Claude Cowork or ChatGPT Work; your agent changes the flow and saves it here.'
        )}
      </div>
    </div>
  );
};

// One of My flows, read only: what it is for, what it makes, its base and
// its method. Rename, Share and Delete are here; every other change goes
// through the workspace's agent ("Edit with your agent").
export const FlowView: FC<{
  slug: string;
  onChanged: () => void;
  onDeleted: () => void;
}> = ({ slug, onChanged, onDeleted }) => {
  const t = useT();
  const { data: flow, error, mutate: refresh } = useUserFlow(slug);
  const changed = useCallback(() => {
    refresh();
    onChanged();
  }, [refresh, onChanged]);
  const { busy, share, unshare, remove } = useMyFlowActions(
    { slug, title: flow?.title || slug },
    changed
  );

  if (error) {
    return (
      <div className="text-[14px] text-textItemBlur py-[24px]">
        {t('flows_editor_not_found', 'This flow could not be read.')}
      </div>
    );
  }
  if (!flow) {
    return <LoadingComponent />;
  }
  return (
    <div className="flex flex-col gap-[16px] w-[min(720px,90vw)]">
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
      <FlowTitle
        key={flow.title}
        slug={flow.slug}
        title={flow.title}
        onRenamed={changed}
      />
      <div className="text-[12px] text-textItemBlur font-mono -mt-[8px]">
        my/{flow.slug}
      </div>
      {!!flow.whenToUse && (
        <div className="flex flex-col gap-[4px]">
          <div className={KICKER}>{t('flows_editor_when', 'When to use it')}</div>
          <div className="text-[14px] leading-[1.5]">{flow.whenToUse}</div>
        </div>
      )}
      {!!flow.summary && (
        <div className="flex flex-col gap-[4px]">
          <div className={KICKER}>{t('flows_editor_summary', 'What it makes')}</div>
          <div className="text-[14px] leading-[1.5] whitespace-pre-line">
            {flow.summary}
          </div>
        </div>
      )}
      {/* A cost line with credit placeholders is priced by the gateway when
          the flow runs; only a plain one is shown here. */}
      {!!flow.cost && !flow.cost.includes('{{') && (
        <div className="flex flex-col gap-[4px]">
          <div className={KICKER}>{t('flows_cost_title', 'Cost')}</div>
          <div className="text-[14px] leading-[1.5]">{flow.cost}</div>
        </div>
      )}
      {!!flow.basedOn && <FlowBaseCard basedOn={flow.basedOn} />}
      <FlowMethod
        customization={flow.customization}
        body={flow.body}
        parts={flow.parts}
        based={!!flow.basedOn}
      />
      <EditWithAgent slug={flow.slug} title={flow.title} />
      <div className="flex items-center gap-[6px] flex-wrap">
        {flow.shareable !== false && (
          <ActionButton
            label={
              flow.shared
                ? t('flows_mine_copy_link', 'Copy link')
                : t('flows_mine_share', 'Share')
            }
            onClick={share}
            disabled={busy}
          />
        )}
        {flow.shared && (
          <ActionButton
            label={t('flows_mine_stop_sharing', 'Stop sharing')}
            onClick={unshare}
            disabled={busy}
          />
        )}
        <ActionButton
          label={t('flows_mine_delete', 'Delete')}
          onClick={async () => {
            if (await remove()) {
              onDeleted();
            }
          }}
          danger={true}
          disabled={busy}
        />
      </div>
    </div>
  );
};

// Opens one of My flows in a modal.
export const useOpenFlowView = (onChanged: () => void) => {
  const modals = useModals();
  const t = useT();
  return useCallback(
    (slug: string) =>
      modals.openModal({
        title: t('flows_view_title', 'My flow'),
        withCloseButton: true,
        children: (close: () => void) => (
          <FlowView slug={slug} onChanged={onChanged} onDeleted={close} />
        ),
      }),
    [modals, t, onChanged]
  );
};
