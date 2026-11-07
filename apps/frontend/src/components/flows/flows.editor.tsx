'use client';

import { FC, ReactNode, useMemo, useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  Flow,
  useFlows,
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
import {
  AddSkillButton,
  FlowSkillsRow,
  skillLink,
  skillLinksIn,
  UploadSkillButton,
} from '@gitroom/frontend/components/flows/flows.skills';
import {
  USER_FLOW_BODY_MAX,
  USER_FLOW_CUSTOMIZATION_MAX,
  USER_FLOW_SKILLS_MAX,
} from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

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
  // Never the flow itself, nor a flow based on it (directly or through
  // others): the base would lead back to it.
  const flows = mine?.flows || [];
  const below = new Set(slug ? [slug] : []);
  let level = slug ? [slug] : [];
  while (level.length) {
    const bases = new Set(level.map((one) => `my/${one}`));
    const next = flows
      .filter(
        (one) => !below.has(one.slug) && bases.has(one.basedOn || '')
      )
      .map((one) => one.slug);
    next.forEach((one) => below.add(one));
    level = next;
  }
  const own = flows.filter((one) => !below.has(one.slug));
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

// "Instructions": the one text a flow is written in (its method, or what a
// custom flow changes in its base), with skill links put in where they
// apply. "+ Add skill" and "Upload .md" insert at the caret (at the end
// when the text was never focused).
const Instructions: FC<{
  based: boolean;
  value: string;
  onChange: (value: string) => void;
  // The skills the flow brings in now: the links in its texts and the
  // skills listed without a link.
  links: Map<string, string>;
  listed: string[];
  onRemoveListed: (reference: string) => void;
}> = ({ based, value, onChange, links, listed, onRemoveListed }) => {
  const t = useT();
  const toaster = useToaster();
  const area = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  const max = based ? USER_FLOW_CUSTOMIZATION_MAX : USER_FLOW_BODY_MAX;
  const used = useMemo(
    () => new Set([...Array.from(links.keys()), ...listed]),
    [links, listed]
  );

  const insert = (snippet: string, block: boolean) => {
    const el = area.current;
    const start = el && focused.current ? el.selectionStart : value.length;
    const end = el && focused.current ? el.selectionEnd : value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    // A link sits in the sentence; a pasted text gets lines of its own.
    const lead = !before || /\s$/.test(before) ? '' : block ? '\n\n' : ' ';
    const trail = !after || /^\s/.test(after) ? '' : block ? '\n\n' : ' ';
    const text = `${lead}${snippet}${trail}`;
    const next = `${before}${text}${after}`;
    if (next.length > max) {
      toaster.show(
        t(
          'flows_editor_instructions_full',
          'The instructions would be longer than {{max}} characters.',
          { max: max.toLocaleString() }
        ),
        'warning'
      );
      return;
    }
    onChange(next);
    const caret = start + lead.length + snippet.length;
    requestAnimationFrame(() => {
      if (area.current) {
        area.current.focus();
        area.current.setSelectionRange(caret, caret);
      }
    });
  };
  const insertSkill = (name: string, reference: string) =>
    insert(skillLink(name, reference), false);

  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex items-end gap-[8px] flex-wrap">
        <span className="flex-1 text-[13px] font-[600]">
          {t('flows_editor_instructions', 'Instructions')}
        </span>
        <AddSkillButton used={used} onPick={insertSkill} />
        <UploadSkillButton
          canLink={used.size < USER_FLOW_SKILLS_MAX}
          onInsertText={(text) => insert(text, true)}
          onInsertSkill={insertSkill}
        />
      </div>
      <textarea
        ref={area}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => (focused.current = true)}
        maxLength={max}
        rows={based ? 10 : 14}
        dir="auto"
        className={`${INPUT} py-[10px] font-mono text-[13px] leading-[1.6] resize-y`}
      />
      <span className="text-[12px] leading-[1.5] text-textItemBlur">
        {based
          ? t(
              'flows_editor_instructions_based_hint',
              'What to change or add; this wins over the base method. "+ Add skill" puts a skill in where it applies.'
            )
          : t(
              'flows_editor_instructions_hint',
              'The steps, in Markdown. "+ Add skill" puts a skill in where it applies; your agent reads it at that step.'
            )}
      </span>
      <FlowSkillsRow
        links={links}
        listed={listed}
        onRemoveListed={onRemoveListed}
      />
    </div>
  );
};

const FlowForm: FC<{
  slug: string | null;
  initial: UserFlowFields;
  // The flow's named parts, which the editor keeps as they are: their skill
  // links count too.
  parts?: Record<string, string> | null;
  onSaved: (saved: UserFlowSaved) => void;
}> = ({ slug, initial, parts, onSaved }) => {
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
  // What the skill links of the flow's texts bring in, as the server
  // derives it on save.
  const links = useMemo(
    () =>
      skillLinksIn([
        fields.body,
        fields.customization,
        ...Object.values(parts || {}),
      ]),
    [fields.body, fields.customization, parts]
  );
  const listed = fields.skills || [];
  const tooMany =
    new Set([...Array.from(links.keys()), ...listed]).size >
    USER_FLOW_SKILLS_MAX;

  // Switching between a blank flow and a base keeps what was written in
  // sight, so nothing hidden is saved: the method moves into the
  // customization, and back (after the method, a blank line between).
  const startFrom = (basedOn: string) =>
    setFields((now) => {
      const join = (first?: string, second?: string) =>
        [first, second]
          .map((one) => (one || '').trim())
          .filter(Boolean)
          .join('\n\n');
      if (basedOn && !now.basedOn) {
        return {
          ...now,
          basedOn,
          customization: join(now.customization, now.body),
          body: '',
        };
      }
      if (!basedOn && now.basedOn) {
        return {
          ...now,
          basedOn: '',
          body: join(now.body, now.customization),
          customization: '',
        };
      }
      return { ...now, basedOn };
    });

  const save = async () => {
    if (!fields.title?.trim() || saving || tooMany) {
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
      <Field
        label={t('flows_editor_summary', 'What it makes')}
        hint={t(
          'flows_editor_summary_hint',
          'One line on the result: "a 6-slide LinkedIn carousel with a caption".'
        )}
      >
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
      <Instructions
        based={based}
        value={(based ? fields.customization : fields.body) || ''}
        onChange={(value) =>
          setFields((now) => ({
            ...now,
            [based ? 'customization' : 'body']: value,
          }))
        }
        links={links}
        listed={listed}
        onRemoveListed={(reference) =>
          setFields((now) => ({
            ...now,
            skills: (now.skills || []).filter((one) => one !== reference),
          }))
        }
      />
      {tooMany && (
        <div className="text-[12px] leading-[1.5] text-warm">
          {t(
            'flows_editor_skills_full',
            'A flow brings in at most {{max}} skills.',
            { max: USER_FLOW_SKILLS_MAX }
          )}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!fields.title?.trim() || saving || tooMany}
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

// The stored skills of a flow that no skill link in its texts names: what
// older flows listed on their own.
const unlinked = (flow: {
  body: string;
  customization: string;
  parts: Record<string, string> | null;
  skills: string[];
}) => {
  const links = skillLinksIn([
    flow.body,
    flow.customization,
    ...Object.values(flow.parts || {}),
  ]);
  return (flow.skills || []).filter((one) => !links.has(one));
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
      parts={data?.parts}
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
              // Only the skills no link names: the links bring in the rest.
              skills: unlinked(data),
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
