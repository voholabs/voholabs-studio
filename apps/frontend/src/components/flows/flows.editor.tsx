'use client';

import { FC, ReactNode, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { openPlus } from '@gitroom/frontend/components/wallet/wallet.bridge';
import { LockIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';
import {
  Flow,
  useFlows,
  useSkillsList,
  useUserFlow,
  useUserFlowActions,
  useUserFlows,
  UserFlowFields,
  UserFlowSaved,
  UserFlowSummary,
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

// A flow can bring in this many skills.
const SKILLS_MAX = 5;

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

// "Start from": blank, a Voho library flow or one of My flows (never the
// flow itself).
const StartFrom: FC<{
  slug: string | null;
  value: string;
  onChange: (basedOn: string) => void;
}> = ({ slug, value, onChange }) => {
  const t = useT();
  const { data: library } = useFlows();
  const { data: mine } = useUserFlows();
  const own = (mine?.flows || []).filter((one) => one.slug !== slug);
  const known =
    !value ||
    (library || []).some((one) => one.id === value) ||
    own.some((one) => `my/${one.slug}` === value);
  return (
    <Field
      label={t('flows_editor_start_from', 'Start from')}
      hint={t(
        'flows_editor_start_from_hint',
        'Base this flow on another one to keep its method and change only what you need. The base is read each time the flow runs, so updates to it reach this flow too.'
      )}
    >
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${INPUT} h-[40px] cursor-pointer`}
      >
        <option value="">{t('flows_editor_blank', 'Blank')}</option>
        {!known && <option value={value}>{value}</option>}
        {!!library?.length && (
          <optgroup label={t('flows_library_title', 'Voho library')}>
            {library.map((one) => (
              <option key={one.id} value={one.id}>
                {one.title}
              </option>
            ))}
          </optgroup>
        )}
        {!!own.length && (
          <optgroup label={t('flows_mine_title', 'My flows')}>
            {own.map((one) => (
              <option key={one.slug} value={`my/${one.slug}`}>
                {one.title}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </Field>
  );
};

// The base a custom flow keeps, read only: its method is not copied here.
const BaseCard: FC<{ basedOn: string }> = ({ basedOn }) => {
  const t = useT();
  const { data: library } = useFlows();
  const { data: mine } = useUserFlows();
  const base = findBase(basedOn, library, mine?.flows);
  const loading = !library || !mine;
  return (
    <div className="flex flex-col gap-[4px] rounded-[10px] border border-newTableBorder bg-newTableHeader px-[14px] py-[12px]">
      <div className="text-[12px] font-[500] uppercase tracking-[0.08em] text-textItemBlur">
        {basedOn.startsWith('my/')
          ? t('flows_editor_base_mine', 'Based on one of My flows')
          : t('flows_editor_base_library', 'Based on a Voho library flow')}
      </div>
      <div className="text-[15px] font-[700] leading-[1.3] break-words">
        {base?.title || basedOn}
      </div>
      {base ? (
        !!base.summary && (
          <div className="text-[13px] leading-[1.5] text-textItemBlur line-clamp-3">
            {base.summary}
          </div>
        )
      ) : (
        !loading && (
          <div className="text-[13px] leading-[1.5] text-warm">
            {t(
              'flows_editor_base_gone',
              'This flow is no longer available. Your customization is kept.'
            )}
          </div>
        )
      )}
    </div>
  );
};

// The skills a flow brings in, as chips to switch on and off. The skills
// library opens with Plus: without it, a lock line.
const SkillsPicker: FC<{
  value: string[];
  onChange: (skills: string[]) => void;
}> = ({ value, onChange }) => {
  const t = useT();
  const { data, error } = useSkillsList();
  if (error) {
    return null;
  }
  const toggle = (slug: string) =>
    onChange(
      value.includes(slug)
        ? value.filter((one) => one !== slug)
        : [...value, slug].slice(0, SKILLS_MAX)
    );
  const known = new Set((data?.skills || []).map((one) => one.slug));
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-[13px] font-[600]">
        {t('flows_editor_skills', 'Skills')}
      </span>
      {!data ? (
        <span className="text-[12px] text-textItemBlur">
          {t('flows_editor_skills_loading', 'Loading skills...')}
        </span>
      ) : data.locked ? (
        <div className="flex items-center gap-[8px] flex-wrap rounded-[8px] px-[12px] py-[10px] bg-warmSoft text-[13px] leading-[1.5]">
          <span className="text-warm shrink-0">
            <LockIcon size={12} />
          </span>
          <span className="text-textItemBlur">
            {t(
              'flows_editor_skills_locked',
              'Skills are included with Plus.'
            )}
          </span>
          <button
            type="button"
            onClick={() => openPlus()}
            className="text-warm font-[600] hover:underline"
          >
            {t('plus_get', 'Get Plus')}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-[6px]">
          {data.skills.map((skill) => {
            const on = value.includes(skill.slug);
            return (
              <button
                key={skill.slug}
                type="button"
                title={skill.summary}
                aria-pressed={on}
                disabled={!on && value.length >= SKILLS_MAX}
                onClick={() => toggle(skill.slug)}
                className={`h-[28px] px-[10px] rounded-full text-[12px] font-[600] border transition-colors disabled:opacity-50 ${
                  on
                    ? 'bg-tealSoft text-tealText border-tealText'
                    : 'border-newTableBorder text-newTextColor hover:border-tealText'
                }`}
              >
                {skill.name}
              </button>
            );
          })}
          {value
            .filter((slug) => !known.has(slug))
            .map((slug) => (
              <button
                key={slug}
                type="button"
                aria-pressed={true}
                onClick={() => toggle(slug)}
                title={t(
                  'flows_editor_skill_gone',
                  'No longer in the skills library'
                )}
                className="h-[28px] px-[10px] rounded-full text-[12px] font-[600] border border-newTableBorder text-textItemBlur line-through"
              >
                {slug}
              </button>
            ))}
        </div>
      )}
      {!!data && !data.locked && (
        <span className="text-[12px] leading-[1.5] text-textItemBlur">
          {t(
            'flows_editor_skills_hint',
            'Up to 5. Your agent reads them as part of this flow.'
          )}
        </span>
      )}
    </div>
  );
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
  const based = !!fields.basedOn;

  // Switching between a blank flow and a base keeps what was written in
  // sight: the method becomes the customization, and back.
  const startFrom = (basedOn: string) =>
    setFields((now) => {
      const body = (now.body || '').trim();
      const customization = (now.customization || '').trim();
      if (basedOn && !now.basedOn && body && !customization) {
        return { ...now, basedOn, customization: now.body, body: '' };
      }
      if (!basedOn && now.basedOn && customization && !body) {
        return {
          ...now,
          basedOn: '',
          body: now.customization,
          customization: '',
        };
      }
      return { ...now, basedOn };
    });

  const save = async () => {
    if (!fields.title?.trim() || saving) {
      return;
    }
    setSaving(true);
    const payload = {
      ...fields,
      category: fields.category || null,
      basedOn: fields.basedOn || null,
    };
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
      <StartFrom
        slug={slug}
        value={fields.basedOn || ''}
        onChange={startFrom}
      />
      {based && <BaseCard basedOn={fields.basedOn as string} />}
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
      {based ? (
        <Field
          label={t('flows_editor_customization', 'Customization')}
          hint={t(
            'flows_editor_customization_hint',
            'What to change or add; this wins over the base method'
          )}
        >
          <textarea
            value={fields.customization || ''}
            onChange={set('customization')}
            maxLength={20000}
            rows={10}
            dir="auto"
            className={`${INPUT} py-[10px] font-mono text-[13px] leading-[1.6] resize-y`}
          />
        </Field>
      ) : (
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
      )}
      <SkillsPicker
        value={fields.skills || []}
        onChange={(skills) => setFields((now) => ({ ...now, skills }))}
      />
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

// Writes a new flow (slug null), optionally based on a flow from the start
// (basedOn), or edits one of My flows.
export const FlowEditor: FC<{
  slug: string | null;
  basedOn?: string;
  onSaved: (saved: UserFlowSaved) => void;
}> = ({ slug, basedOn, onSaved }) => {
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
              basedOn: data.basedOn || '',
              customization: data.customization || '',
              skills: data.skills || [],
            }
          : {
              title: '',
              whenToUse: '',
              summary: '',
              category: '',
              body: '',
              basedOn: basedOn || '',
              customization: '',
              skills: [],
            }
      }
    />
  );
};
