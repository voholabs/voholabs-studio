'use client';

import { FC, ReactNode, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  useUserFlow,
  useUserFlowActions,
  UserFlowFields,
  UserFlowSaved,
} from '@gitroom/frontend/components/flows/flows.hooks';
import {
  FLOW_CATEGORIES,
  flowCategoryLabel,
} from '@gitroom/frontend/components/flows/flows.card';

const INPUT =
  'w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] text-[14px] outline-none focus:border-tealText transition-colors';

const Field: FC<{ label: string; hint?: string; children: ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <label className="flex flex-col gap-[6px]">
    <span className="text-[13px] font-[600]">{label}</span>
    {children}
    {!!hint && (
      <span className="text-[12px] leading-[1.5] text-textItemBlur">{hint}</span>
    )}
  </label>
);

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

const FlowForm: FC<{
  slug: string | null;
  initial: UserFlowFields;
  onSaved: (saved: UserFlowSaved) => void;
}> = ({ slug, initial, onSaved }) => {
  const t = useT();
  const actions = useUserFlowActions();
  const showWarnings = useShowFlowWarnings();
  const [fields, setFields] = useState<UserFlowFields>(initial);
  const [saving, setSaving] = useState(false);
  const set =
    (key: keyof UserFlowFields) =>
    (event: { target: { value: string } }) =>
      setFields((now) => ({ ...now, [key]: event.target.value }));

  const save = async () => {
    if (!fields.title?.trim() || saving) {
      return;
    }
    setSaving(true);
    const payload = { ...fields, category: fields.category || null };
    const saved = slug
      ? await actions.update(slug, payload)
      : await actions.create(payload);
    setSaving(false);
    if (saved) {
      showWarnings(saved);
      onSaved(saved);
    }
  };

  return (
    <div className="flex flex-col gap-[16px] w-[min(720px,90vw)]">
      <div className="text-[13px] leading-[1.5] text-textItemBlur">
        {t(
          'flows_editor_intro',
          'A flow is the method your agent follows. Keep it to the steps and the style: your brand (colours, fonts, logo, voice, audience) comes from your brief each time the flow runs.'
        )}
      </div>
      <Field label={t('flows_editor_title', 'Title')}>
        <input
          value={fields.title || ''}
          onChange={set('title')}
          maxLength={160}
          className={`${INPUT} h-[40px]`}
        />
      </Field>
      <Field
        label={t('flows_editor_when', 'When to use it')}
        hint={t(
          'flows_editor_when_hint',
          'The requests this flow is for, in your words: "a weekly recap for LinkedIn".'
        )}
      >
        <input
          value={fields.whenToUse || ''}
          onChange={set('whenToUse')}
          maxLength={1000}
          className={`${INPUT} h-[40px]`}
        />
      </Field>
      <Field label={t('flows_editor_summary', 'What you get')}>
        <textarea
          value={fields.summary || ''}
          onChange={set('summary')}
          maxLength={1000}
          rows={2}
          className={`${INPUT} py-[10px] resize-y`}
        />
      </Field>
      <Field label={t('flows_editor_category', 'Category')}>
        <select
          value={fields.category || ''}
          onChange={set('category')}
          className={`${INPUT} h-[40px] cursor-pointer`}
        >
          <option value="">{t('flows_editor_no_category', 'None')}</option>
          {FLOW_CATEGORIES.map((key) => (
            <option key={key} value={key}>
              {flowCategoryLabel(t, key)}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label={t('flows_editor_method', 'The method')}
        hint={t(
          'flows_editor_method_hint',
          'The steps, in Markdown. Your agent reads this when it runs the flow.'
        )}
      >
        <textarea
          value={fields.body || ''}
          onChange={set('body')}
          maxLength={100000}
          rows={14}
          dir="auto"
          className={`${INPUT} py-[10px] font-mono text-[13px] leading-[1.6] resize-y`}
        />
      </Field>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!fields.title?.trim() || saving}
          className="h-[40px] px-[20px] rounded-[8px] bg-btnPrimary hover:brightness-110 text-white text-[14px] font-[600] disabled:opacity-50 transition-all"
        >
          {saving
            ? t('flows_editor_saving', 'Saving...')
            : t('flows_editor_save', 'Save flow')}
        </button>
      </div>
    </div>
  );
};

// Writes a new flow (slug null) or edits one of My flows.
export const FlowEditor: FC<{
  slug: string | null;
  onSaved: (saved: UserFlowSaved) => void;
}> = ({ slug, onSaved }) => {
  const t = useT();
  const { data, error } = useUserFlow(slug);

  if (slug && error) {
    return (
      <div className="text-[14px] text-textItemBlur py-[24px]">
        {t('flows_editor_not_found', 'This flow could not be read.')}
      </div>
    );
  }
  if (slug && !data) {
    return <LoadingComponent />;
  }
  return (
    <FlowForm
      slug={slug}
      onSaved={onSaved}
      initial={
        data
          ? {
              title: data.title,
              whenToUse: data.whenToUse,
              summary: data.summary,
              category: data.category,
              body: data.body,
            }
          : { title: '', whenToUse: '', summary: '', category: '', body: '' }
      }
    />
  );
};
