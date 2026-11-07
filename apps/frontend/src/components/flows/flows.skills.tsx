'use client';

import {
  ChangeEvent,
  FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useSWRConfig } from 'swr';
import { useClickOutside } from '@mantine/hooks';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { openPlus } from '@gitroom/frontend/components/wallet/wallet.bridge';
import { LockIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';
import {
  UserSkill,
  UserSkillFields,
  UserSkillSummary,
  useSkillsList,
  useUserFlowActions,
  useUserSkill,
  useUserSkills,
} from '@gitroom/frontend/components/flows/flows.hooks';
import {
  SKILL_CHIP,
  USER_FLOW_SKILLS_MAX,
  USER_SKILL_BODY_MAX,
  USER_SKILL_DESCRIPTION_MAX,
  USER_SKILL_NAME_MAX,
} from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

const INPUT =
  'w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] text-[14px] outline-none focus:border-tealText transition-colors';

const MY = 'my/';

// An uploaded skill file is read whole up to this size.
const UPLOAD_MAX = 64 * 1024;

// A skill link as the flow's text holds it: "[Skill: Hooks](skill:hooks)",
// "[Skill: Brand tone](skill:my/brand-tone)". The label is display only.
export const skillLink = (name: string, reference: string) =>
  `[Skill: ${
    name.replace(/[\]\n\r]+/g, ' ').trim().slice(0, 80) || reference
  }](skill:${reference})`;

// A text with every link to one skill taken out (a skill that is gone).
export const withoutSkillLink = (
  text: string | undefined,
  reference: string
) =>
  text?.replace(SKILL_CHIP, (link: string, _label: string, one: string) =>
    one === reference ? '' : link
  );

// The skills the links in these texts name, in order, with the label of
// their first link.
export const skillLinksIn = (texts: Array<string | null | undefined>) => {
  const found = new Map<string, string>();
  for (const text of texts) {
    for (const match of (text || '').matchAll(SKILL_CHIP)) {
      if (!found.has(match[2])) {
        found.set(match[2], match[1].trim());
      }
    }
  }
  return found;
};

// A SKILL.md: a front matter block ("---" lines around name: and
// description:) and the instructions after it. Any other Markdown is all
// instructions.
const FRONT_MATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const readSkillFile = (text: string) => {
  const match = text.match(FRONT_MATTER);
  const field = (key: string) => {
    const line = match?.[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
    return (line?.[1] || '')
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .trim();
  };
  return {
    name: field('name'),
    description: field('description'),
    body: (match ? text.slice(match[0].length) : text).trim(),
  };
};

// The form of one of My skills: a new one (slug null) or an edit.
const SkillForm: FC<{
  slug: string | null;
  initial: UserSkillFields;
  onSaved: (skill: UserSkill) => void;
}> = ({ slug, initial, onSaved }) => {
  const t = useT();
  const actions = useUserFlowActions();
  const { mutate } = useSWRConfig();
  const [fields, setFields] = useState<UserSkillFields>(initial);
  const [saving, setSaving] = useState(false);
  const ready = !!fields.name.trim() && !!fields.body.trim();

  const save = async () => {
    if (!ready || saving) {
      return;
    }
    setSaving(true);
    const saved = slug
      ? await actions.updateSkill(slug, fields)
      : await actions.createSkill(fields);
    setSaving(false);
    if (saved) {
      await mutate('user-skills');
      await mutate(`user-skill-${saved.slug}`, saved, { revalidate: false });
      onSaved(saved);
    }
  };

  return (
    <div className="flex flex-col gap-[16px] w-[min(720px,90vw)]">
      <div className="text-[13px] leading-[1.5] text-textItemBlur">
        {t(
          'flows_skill_intro',
          'A skill is a set of instructions in Markdown that any of your flows can bring in. Add it to a flow with "+ Add skill".'
        )}
      </div>
      <label className="flex flex-col gap-[6px]">
        <span className="text-[13px] font-[600]">
          {t('flows_skill_name', 'Name')}
        </span>
        <input
          value={fields.name}
          onChange={(event) =>
            setFields((now) => ({ ...now, name: event.target.value }))
          }
          maxLength={USER_SKILL_NAME_MAX}
          className={`${INPUT} h-[40px]`}
        />
      </label>
      <label className="flex flex-col gap-[6px]">
        <span className="text-[13px] font-[600]">
          {t('flows_skill_description', 'What it is for')}
        </span>
        <input
          value={fields.description}
          onChange={(event) =>
            setFields((now) => ({ ...now, description: event.target.value }))
          }
          maxLength={USER_SKILL_DESCRIPTION_MAX}
          className={`${INPUT} h-[40px]`}
        />
      </label>
      <label className="flex flex-col gap-[6px]">
        <span className="text-[13px] font-[600]">
          {t('flows_skill_body', 'Instructions')}
        </span>
        <textarea
          value={fields.body}
          onChange={(event) =>
            setFields((now) => ({ ...now, body: event.target.value }))
          }
          maxLength={USER_SKILL_BODY_MAX}
          rows={14}
          dir="auto"
          className={`${INPUT} py-[10px] font-mono text-[13px] leading-[1.6] resize-y`}
        />
        <span className="text-[12px] leading-[1.5] text-textItemBlur">
          {t(
            'flows_skill_body_hint',
            'In Markdown. Your agent reads this wherever a flow brings the skill in.'
          )}
        </span>
      </label>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!ready || saving}
          className="h-[40px] px-[20px] rounded-[8px] bg-btnPrimary hover:brightness-110 text-white text-[14px] font-[600] disabled:opacity-50 transition-all"
        >
          {saving
            ? t('flows_editor_saving', 'Saving...')
            : t('flows_skill_save', 'Save skill')}
        </button>
      </div>
    </div>
  );
};

const SkillEditor: FC<{
  slug: string | null;
  onSaved: (skill: UserSkill) => void;
}> = ({ slug, onSaved }) => {
  const t = useT();
  const { data, error } = useUserSkill(slug);
  if (slug && error) {
    return (
      <div className="text-[14px] text-textItemBlur py-[24px]">
        {t('flows_skill_not_found', 'This skill could not be read.')}
      </div>
    );
  }
  if (slug && !data) {
    return <LoadingComponent />;
  }
  return (
    <SkillForm
      slug={slug}
      onSaved={onSaved}
      initial={
        data
          ? { name: data.name, description: data.description, body: data.body }
          : { name: '', description: '', body: '' }
      }
    />
  );
};

// Opens the skill form in a modal: a new skill (slug null) or one of mine.
export const useOpenSkillEditor = () => {
  const modals = useModals();
  const t = useT();
  return useCallback(
    (slug: string | null, onSaved?: (skill: UserSkill) => void) =>
      modals.openModal({
        title: slug
          ? t('flows_skill_edit', 'Edit skill')
          : t('flows_skill_new', 'New skill'),
        withCloseButton: true,
        children: (close: () => void) => (
          <SkillEditor
            slug={slug}
            onSaved={(skill) => {
              onSaved?.(skill);
              close();
            }}
          />
        ),
      }),
    [modals, t]
  );
};

const SmallButton: FC<{
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

const MySkillCard: FC<{
  skill: UserSkillSummary;
  onEdit: (slug: string) => void;
  onChanged: () => void;
}> = ({ skill, onEdit, onChanged }) => {
  const t = useT();
  const actions = useUserFlowActions();
  const [busy, setBusy] = useState(false);

  // A skill a flow brings in is refused with the flows that do, as a toast.
  const remove = async () => {
    if (
      !(await deleteDialog(
        t('flows_skill_delete_confirm', 'Delete the skill "{{name}}"?', {
          name: skill.name,
        }),
        t('flows_mine_delete', 'Delete')
      ))
    ) {
      return;
    }
    setBusy(true);
    const deleted = await actions.removeSkill(skill.slug);
    setBusy(false);
    if (deleted) {
      onChanged();
    }
  };

  return (
    <div className="flex flex-col gap-[8px] rounded-[12px] border border-newTableBorder bg-newTableHeader p-[14px] min-w-0">
      <button
        type="button"
        onClick={() => onEdit(skill.slug)}
        className="text-start text-[15px] font-[700] leading-[1.25] line-clamp-2 hover:underline break-words"
      >
        {skill.name}
      </button>
      {!!skill.description && (
        <div className="text-[13px] leading-[1.4] text-textItemBlur line-clamp-2">
          {skill.description}
        </div>
      )}
      <div className="text-[12px] text-textItemBlur font-mono">
        {MY}
        {skill.slug}
      </div>
      <div className="flex items-center gap-[6px] flex-wrap mt-auto">
        <SmallButton
          label={t('flows_mine_edit', 'Edit')}
          onClick={() => onEdit(skill.slug)}
          disabled={busy}
        />
        <SmallButton
          label={t('flows_mine_delete', 'Delete')}
          onClick={remove}
          danger={true}
          disabled={busy}
        />
      </div>
    </div>
  );
};

// "My skills", under My flows: the workspace's own skills. Hidden while
// flows are locked (My flows says what Plus opens).
export const MySkillsSection: FC = () => {
  const t = useT();
  const { data, mutate } = useUserSkills();
  const openEditor = useOpenSkillEditor();
  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);
  const edit = useCallback(
    (slug: string | null) => openEditor(slug, refresh),
    [openEditor, refresh]
  );
  if (!data || data.locked) {
    return null;
  }
  return (
    <section className="flex flex-col gap-[12px]">
      <div className="flex items-center gap-[12px]">
        <h2 className="flex-1 text-[18px] font-[700]">
          {t('flows_skills_mine_title', 'My skills')}
        </h2>
        <button
          type="button"
          onClick={() => edit(null)}
          className="h-[32px] px-[12px] rounded-[8px] text-[13px] font-[600] border border-newTableBorder hover:border-tealText"
        >
          {t('flows_skill_new', 'New skill')}
        </button>
      </div>
      {!data.skills.length ? (
        <div className="text-[13px] leading-[1.5] text-textItemBlur">
          {t(
            'flows_skills_mine_empty',
            'Nothing here yet. Write a skill once (your brand tone, an offer, a checklist) and bring it into any flow with "+ Add skill", or upload a SKILL.md there.'
          )}
        </div>
      ) : (
        <div className="grid gap-[12px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))]">
          {data.skills.map((skill) => (
            <MySkillCard
              key={skill.slug}
              skill={skill}
              onEdit={edit}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </section>
  );
};

const GROUP =
  'px-[12px] pt-[10px] pb-[4px] text-[11px] font-[600] uppercase tracking-[0.08em] text-textItemBlur';
const OPTION =
  'w-full text-start px-[12px] py-[8px] flex flex-col gap-[2px] hover:bg-newTableHeader disabled:opacity-50 disabled:hover:bg-transparent';

// "+ Add skill": picks a skill from the skills library or My skills and
// hands its link to the editor. "used" are the skills the flow already
// brings in; past the limit only those can be picked again.
export const AddSkillButton: FC<{
  used: Set<string>;
  onPick: (name: string, reference: string) => void;
}> = ({ used, onPick }) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  // Closing hands the focus back to the button, except on a click elsewhere.
  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) {
      button.current?.focus();
    }
  }, []);
  const ref = useClickOutside(() => {
    if (open) {
      close(false);
    }
  });
  // Escape closes the list, before it reaches the modal around the editor.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, close]);
  const { data: library } = useSkillsList();
  const { data: mine, mutate: refreshMine } = useUserSkills();
  const openEditor = useOpenSkillEditor();
  const full = used.size >= USER_FLOW_SKILLS_MAX;
  const search = query.trim().toLowerCase();
  const matches = (...texts: Array<string | null | undefined>) =>
    !search || texts.some((one) => (one || '').toLowerCase().includes(search));

  const pick = (name: string, reference: string) => {
    onPick(name, reference);
    close();
  };
  const newSkill = () => {
    close(false);
    openEditor(null, (skill) => {
      refreshMine();
      onPick(skill.name, `${MY}${skill.slug}`);
    });
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-[30px] px-[10px] rounded-[6px] text-[12px] font-[600] border border-newTableBorder text-newTextColor hover:border-tealText transition-colors"
      >
        {t('flows_editor_add_skill', '+ Add skill')}
      </button>
      {open && (
        <div className="absolute z-[20] start-0 mt-[4px] w-[min(340px,80vw)] max-h-[360px] overflow-y-auto rounded-[10px] border border-newTableBorder bg-newBgColorInner shadow-lg py-[6px]">
          <div className="px-[10px] pb-[6px]">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('flows_editor_skill_search', 'Search skills...')}
              className={`${INPUT} h-[32px] text-[13px]`}
            />
          </div>
          {full && (
            <div className="px-[12px] pb-[6px] text-[12px] leading-[1.5] text-warm">
              {t(
                'flows_editor_skills_full',
                'A flow brings in at most {{max}} skills.',
                { max: USER_FLOW_SKILLS_MAX }
              )}
            </div>
          )}
          <div className={GROUP}>
            {t('flows_editor_skills_library', 'Voho skills library')}
          </div>
          {!library ? (
            <div className="px-[12px] py-[6px] text-[12px] text-textItemBlur">
              {t('flows_editor_skills_loading', 'Loading skills...')}
            </div>
          ) : library.locked ? (
            <div className="flex items-center gap-[8px] flex-wrap mx-[10px] my-[4px] rounded-[8px] px-[10px] py-[8px] bg-warmSoft text-[12px] leading-[1.5]">
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
            library.skills
              .filter((skill) => matches(skill.name, skill.summary))
              .map((skill) => (
                <button
                  key={skill.slug}
                  type="button"
                  disabled={full && !used.has(skill.slug)}
                  onClick={() => pick(skill.name, skill.slug)}
                  className={OPTION}
                >
                  <span className="text-[13px] font-[600]">{skill.name}</span>
                  {!!skill.summary && (
                    <span className="text-[12px] text-textItemBlur line-clamp-1">
                      {skill.summary}
                    </span>
                  )}
                </button>
              ))
          )}
          <div className={GROUP}>{t('flows_skills_mine_title', 'My skills')}</div>
          {!mine ? (
            <div className="px-[12px] py-[6px] text-[12px] text-textItemBlur">
              {t('flows_editor_skills_loading', 'Loading skills...')}
            </div>
          ) : (
            <>
              {mine.skills
                .filter((skill) => matches(skill.name, skill.description))
                .map((skill) => (
                  <button
                    key={skill.slug}
                    type="button"
                    disabled={full && !used.has(`${MY}${skill.slug}`)}
                    onClick={() => pick(skill.name, `${MY}${skill.slug}`)}
                    className={OPTION}
                  >
                    <span className="text-[13px] font-[600]">{skill.name}</span>
                    <span className="text-[12px] text-textItemBlur line-clamp-1">
                      {skill.description || `${MY}${skill.slug}`}
                    </span>
                  </button>
                ))}
              {!mine.locked && (
                <button
                  type="button"
                  disabled={full}
                  onClick={newSkill}
                  className={`${OPTION} text-tealText text-[13px] font-[600]`}
                >
                  {t('flows_editor_new_skill', '+ Write a new skill')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// What to do with an uploaded skill file: put its text into the flow, or
// save it as one of My skills and link it.
const UploadSkillDialog: FC<{
  initial: UserSkillFields;
  canLink: boolean;
  // Each says whether it went into the flow; the dialog closes when it did.
  onInsertText: (text: string) => boolean;
  onSaved: (skill: UserSkill) => boolean;
  onDone: () => void;
}> = ({ initial, canLink, onInsertText, onSaved, onDone }) => {
  const t = useT();
  const actions = useUserFlowActions();
  const { mutate } = useSWRConfig();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [saving, setSaving] = useState(false);
  // Saved but its link did not fit: the button links it without saving again.
  const [saved, setSaved] = useState<UserSkill | null>(null);
  const tooLong = initial.body.length > USER_SKILL_BODY_MAX;

  const save = async () => {
    if (saved) {
      if (onSaved(saved)) {
        onDone();
      }
      return;
    }
    if (!name.trim() || saving || tooLong) {
      return;
    }
    setSaving(true);
    const skill = await actions.createSkill({
      name,
      description,
      body: initial.body,
    });
    setSaving(false);
    if (skill) {
      await mutate('user-skills');
      setSaved(skill);
      if (onSaved(skill)) {
        onDone();
      }
    }
  };

  return (
    <div className="flex flex-col gap-[14px] w-[min(640px,90vw)]">
      <label className="flex flex-col gap-[6px]">
        <span className="text-[13px] font-[600]">
          {t('flows_skill_name', 'Name')}
        </span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={USER_SKILL_NAME_MAX}
          className={`${INPUT} h-[40px]`}
        />
      </label>
      <label className="flex flex-col gap-[6px]">
        <span className="text-[13px] font-[600]">
          {t('flows_skill_description', 'What it is for')}
        </span>
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={USER_SKILL_DESCRIPTION_MAX}
          className={`${INPUT} h-[40px]`}
        />
      </label>
      <div
        dir="auto"
        className="max-h-[220px] overflow-y-auto rounded-[8px] bg-newBgColor p-[12px] font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words"
      >
        {initial.body}
      </div>
      {tooLong && (
        <div className="text-[12px] leading-[1.5] text-warm">
          {t(
            'flows_skill_upload_too_long',
            'This file is longer than a skill can be ({{max}} characters). Its text can still go into the flow.',
            { max: USER_SKILL_BODY_MAX.toLocaleString() }
          )}
        </div>
      )}
      <div className="flex justify-end gap-[8px] flex-wrap">
        <button
          type="button"
          onClick={() => {
            if (onInsertText(initial.body)) {
              onDone();
            }
          }}
          className="h-[40px] px-[16px] rounded-[8px] text-[14px] font-[600] border border-newTableBorder hover:border-tealText"
        >
          {t('flows_skill_upload_insert', 'Insert its text here')}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={
            !saved && (!name.trim() || saving || tooLong || !canLink)
          }
          className="h-[40px] px-[16px] rounded-[8px] bg-btnPrimary hover:brightness-110 text-white text-[14px] font-[600] disabled:opacity-50 transition-all"
        >
          {saving
            ? t('flows_editor_saving', 'Saving...')
            : saved
            ? t('flows_skill_upload_link', 'Add its link here')
            : t('flows_skill_upload_save', 'Save as one of My skills')}
        </button>
      </div>
      {!canLink && !saved && (
        <div className="text-[12px] leading-[1.5] text-textItemBlur text-end">
          {t(
            'flows_editor_skills_full',
            'A flow brings in at most {{max}} skills.',
            { max: USER_FLOW_SKILLS_MAX }
          )}
        </div>
      )}
    </div>
  );
};

// "Upload .md": a SKILL.md (front matter and instructions) or any Markdown
// file, read in the browser; the dialog asks what to do with it.
export const UploadSkillButton: FC<{
  canLink: boolean;
  // Each says whether it went into the flow.
  onInsertText: (text: string) => boolean;
  onInsertSkill: (name: string, reference: string) => boolean;
}> = ({ canLink, onInsertText, onInsertSkill }) => {
  const t = useT();
  const toaster = useToaster();
  const modals = useModals();
  const input = useRef<HTMLInputElement>(null);

  const open = (file: File, text: string) => {
    const read = readSkillFile(text);
    if (!read.body) {
      toaster.show(
        t('flows_skill_upload_empty', 'This file has no instructions in it.'),
        'warning'
      );
      return;
    }
    const fileName = file.name.replace(/\.(md|markdown|txt)$/i, '');
    modals.openModal({
      title: t('flows_skill_upload_title', 'Add a skill file'),
      withCloseButton: true,
      children: (close: () => void) => (
        <UploadSkillDialog
          initial={{
            name: (
              read.name || (/^skill$/i.test(fileName) ? '' : fileName)
            ).slice(0, USER_SKILL_NAME_MAX),
            description: read.description.slice(
              0,
              USER_SKILL_DESCRIPTION_MAX
            ),
            body: read.body,
          }}
          canLink={canLink}
          onInsertText={onInsertText}
          onSaved={(skill) => onInsertSkill(skill.name, `${MY}${skill.slug}`)}
          onDone={close}
        />
      ),
    });
  };

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (file.size > UPLOAD_MAX) {
      toaster.show(
        t(
          'flows_skill_upload_too_big',
          'This file is larger than 64 KB. Pick a smaller Markdown file.'
        ),
        'warning'
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => open(file, String(reader.result || ''));
    reader.onerror = () =>
      toaster.show(
        t('flows_skill_upload_failed', 'This file could not be read.'),
        'warning'
      );
    reader.readAsText(file);
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        onChange={choose}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="h-[30px] px-[10px] rounded-[6px] text-[12px] font-[600] border border-newTableBorder text-newTextColor hover:border-tealText transition-colors"
      >
        {t('flows_editor_upload_md', 'Upload .md')}
      </button>
    </>
  );
};

type SkillState = 'open' | 'locked' | 'missing';

// "Skills in this flow": what the skill links in the texts bring in, then
// the skills listed without a link (older flows), which can be removed
// here. Read only otherwise: a link goes when its text does.
export const FlowSkillsRow: FC<{
  links: Map<string, string>;
  listed: string[];
  onRemoveListed: (reference: string) => void;
  onRemoveLink: (reference: string) => void;
}> = ({ links, listed, onRemoveListed, onRemoveLink }) => {
  const t = useT();
  const { data: library } = useSkillsList();
  const { data: mine } = useUserSkills();
  const all = [
    ...Array.from(links.entries()).map(([reference, label]) => ({
      reference,
      label,
      listed: false,
    })),
    ...listed
      .filter((one) => !links.has(one))
      .map((reference) => ({ reference, label: '', listed: true })),
  ];
  if (!all.length) {
    return null;
  }

  const describe = (
    reference: string,
    label: string
  ): { name: string; state: SkillState } => {
    if (reference.startsWith(MY)) {
      const skill = mine?.skills.find(
        (one) => `${MY}${one.slug}` === reference
      );
      return {
        name: skill?.name || label || reference,
        state: mine && !mine.locked && !skill ? 'missing' : 'open',
      };
    }
    if (library?.locked) {
      return { name: label || reference, state: 'locked' };
    }
    const skill = library?.skills.find((one) => one.slug === reference);
    return {
      name: skill?.name || label || reference,
      state: library && !skill ? 'missing' : 'open',
    };
  };

  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-[12px] font-[600] text-textItemBlur">
        {t('flows_editor_skills_in_flow', 'Skills in this flow')} ({all.length}/
        {USER_FLOW_SKILLS_MAX})
      </span>
      <div className="flex flex-wrap gap-[6px]">
        {all.map(({ reference, label, listed: removable }) => {
          const { name, state } = describe(reference, label);
          const title =
            state === 'locked'
              ? t(
                  'flows_editor_skill_locked',
                  'Included with Plus; the flow runs without it until then'
                )
              : state === 'missing'
              ? t(
                  'flows_editor_skill_missing',
                  'No longer available; the flow runs without it'
                )
              : reference;
          return (
            <span
              key={reference}
              title={title}
              className={`inline-flex items-center gap-[6px] h-[28px] px-[10px] rounded-full text-[12px] font-[600] border max-w-full ${
                state === 'open'
                  ? 'bg-tealSoft text-tealText border-tealText'
                  : state === 'locked'
                  ? 'bg-warmSoft text-warm border-transparent'
                  : 'border-newTableBorder text-textItemBlur line-through'
              }`}
            >
              {state === 'locked' && <LockIcon size={10} />}
              <span className="truncate">{name}</span>
              {reference.startsWith(MY) && (
                <span className="font-[500] opacity-70">
                  {t('flows_editor_skill_mine', 'mine')}
                </span>
              )}
              {(removable || state === 'missing') && (
                <button
                  type="button"
                  onClick={() =>
                    removable
                      ? onRemoveListed(reference)
                      : onRemoveLink(reference)
                  }
                  aria-label={t('flows_editor_skill_remove', 'Remove')}
                  className="opacity-70 hover:opacity-100 no-underline"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
};
