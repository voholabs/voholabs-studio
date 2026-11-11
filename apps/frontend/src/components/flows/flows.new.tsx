'use client';

import { FC, ReactNode, useCallback, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  useFlows,
  useUserFlows,
} from '@gitroom/frontend/components/flows/flows.hooks';
import { useCopyPrompt } from '@gitroom/frontend/components/flows/flows.drawer';
import {
  findBase,
  PROMPT_BASED_ON,
  PROMPT_STUDIO,
} from '@gitroom/frontend/components/flows/flows.view';

// Custom flows are made by the workspace's agent: this dialog writes the
// prompt that asks it to, either from a description (based on a flow or
// from scratch) or from a set of reference videos whose style it learns.
// The prompts go to the agent as written, so they are not translated.

// What the user says the flow should do or change.
const DESCRIBE_MAX = 2000;
// The reference videos a style is learned from.
const REFERENCES_MAX = 8;
// The user's own rules for a learned style.
const RULES_MAX = 2000;

// "Describe it": a custom flow based on another flow, or written from
// scratch.
export const describePrompt = (
  base: { id: string; title: string } | undefined,
  description: string
) =>
  [
    `Make a custom flow for me using ${PROMPT_STUDIO} and save it to my flows. ${
      base
        ? `Base it on the "${base.title}" flow (${base.id}): keep its method and change only what I say below.`
        : 'Write it from scratch: a reusable playbook with the steps, the approval points and the tools each step uses; if it makes a video or images, base it on the closest Voho library flow so its engine renders it.'
    } Method and style only: my brand comes from my brief. Show me the flow before saving it. ${PROMPT_BASED_ON}`,
    description.trim(),
  ]
    .filter(Boolean)
    .join('\n');

// The reference links typed one per line, at most REFERENCES_MAX.
export const referenceLinks = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, REFERENCES_MAX);

// "Learn from videos": the style of a set of reference videos, saved as one
// of My flows. With no links, the videos are the files attached in the chat.
export const learnPrompt = (links: string[], rules: string) =>
  [
    `Learn the video style of these reference videos for me using ${PROMPT_STUDIO} and save it as one of my flows: decode how they are edited (rhythm, hook, text, motion, captions, sound), write it down as a flow I can run on my own topics, and tell me which Voho engine renders it and what it cannot copy yet. Analysis only: never reuse their footage, voice, script or music; delete the downloads when done. ${PROMPT_BASED_ON}`,
    links.length
      ? ['Reference videos:', ...links].join('\n')
      : 'Reference videos: the files I attach in this chat',
    rules.trim() ? `My rules: ${rules.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

type Tab = 'describe' | 'learn';

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
      <span className="text-[12px] leading-[1.5] text-textItemBlur">
        {hint}
      </span>
    )}
  </label>
);

// "Start from": blank, a Voho library flow or one of My flows.
const StartFrom: FC<{
  value: string;
  onChange: (basedOn: string) => void;
}> = ({ value, onChange }) => {
  const t = useT();
  const { data: library } = useFlows();
  const { data: mine } = useUserFlows();
  const own = mine?.flows || [];
  const known =
    !value ||
    (library || []).some((one) => one.id === value) ||
    own.some((one) => `my/${one.slug}` === value);
  return (
    <Field
      label={t('flows_editor_start_from', 'Start from')}
      hint={t(
        'flows_new_start_from_hint',
        'Base it on another flow to keep its method and change only what you need. Videos and images need a base: its engine renders them.'
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

// The prompt as it will be copied, and the button that copies it.
const PromptPreview: FC<{ prompt: string }> = ({ prompt }) => {
  const t = useT();
  const { copyPrompt, label } = useCopyPrompt(prompt);
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="text-[12px] font-[500] uppercase tracking-[0.08em] text-textItemBlur">
        {t('flows_the_prompt', 'The prompt')}
      </div>
      <div
        dir="auto"
        className="rounded-[8px] bg-newBgColor p-[14px] font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words max-h-[220px] overflow-y-auto"
      >
        {prompt}
      </div>
      <button
        type="button"
        onClick={copyPrompt}
        className="w-full h-[44px] rounded-[8px] bg-btnPrimary hover:brightness-110 text-white text-[15px] font-[600] transition-all"
      >
        {label}
      </button>
      <div className="text-[12px] leading-[1.5] text-textItemBlur">
        {t(
          'flows_new_paste_hint',
          'Paste it into Claude Cowork or ChatGPT Work; your agent makes the flow and saves it to My flows.'
        )}
      </div>
    </div>
  );
};

const DescribeTab: FC<{ basedOn?: string }> = ({ basedOn: initial }) => {
  const t = useT();
  const { data: library } = useFlows();
  const { data: mine } = useUserFlows();
  const [basedOn, setBasedOn] = useState(initial || '');
  const [description, setDescription] = useState('');
  const base = findBase(basedOn, library, mine?.flows);
  return (
    <>
      <StartFrom value={basedOn} onChange={setBasedOn} />
      <Field
        label={t('flows_new_describe', 'What it should do or change')}
        hint={t(
          'flows_new_describe_hint',
          'The steps, the format, what to keep or change. Your brand (colours, fonts, voice, audience) comes from your brief.'
        )}
      >
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={DESCRIBE_MAX}
          rows={6}
          dir="auto"
          className={`${INPUT} py-[10px] resize-y`}
        />
      </Field>
      <PromptPreview
        prompt={describePrompt(
          basedOn ? { id: basedOn, title: base?.title || basedOn } : undefined,
          description
        )}
      />
    </>
  );
};

const LearnTab: FC = () => {
  const t = useT();
  const [references, setReferences] = useState('');
  const [rules, setRules] = useState('');
  const typed = references.split('\n').filter((line) => line.trim()).length;
  return (
    <>
      <Field
        label={t('flows_new_references', 'Reference videos')}
        hint={t(
          'flows_new_references_hint',
          "One link per line (YouTube, TikTok, Instagram), up to {{max}}, or attach the video files in the chat. 3-6 of the same kind work best; 1 is fine for a single video's look.",
          { max: REFERENCES_MAX }
        )}
      >
        <textarea
          value={references}
          onChange={(event) => setReferences(event.target.value)}
          rows={4}
          dir="ltr"
          placeholder="https://www.youtube.com/shorts/..."
          className={`${INPUT} py-[10px] font-mono text-[13px] resize-y`}
        />
      </Field>
      {typed > REFERENCES_MAX && (
        <div className="text-[12px] leading-[1.5] text-warm -mt-[8px]">
          {t(
            'flows_new_references_max',
            'Only the first {{max}} links go into the prompt.',
            { max: REFERENCES_MAX }
          )}
        </div>
      )}
      <Field
        label={t('flows_new_rules', 'Your rules')}
        hint={t(
          'flows_new_rules_hint',
          'What to keep from your side: your colours, your name on the end card, your niche, anything to avoid.'
        )}
      >
        <textarea
          value={rules}
          onChange={(event) => setRules(event.target.value)}
          maxLength={RULES_MAX}
          rows={3}
          dir="auto"
          className={`${INPUT} py-[10px] resize-y`}
        />
      </Field>
      <div className="text-[12px] leading-[1.5] text-textItemBlur">
        {t(
          'flows_new_engines_note',
          'Voho engines render illustrated, collage, documentary, drink and whiteboard styles; other styles are saved as written rules.'
        )}
      </div>
      <PromptPreview prompt={learnPrompt(referenceLinks(references), rules)} />
    </>
  );
};

// The "New custom flow" dialog: two ways to have the agent make a flow.
// basedOn presets "Describe it" to a flow (the library drawer's Customize).
export const NewCustomFlow: FC<{ basedOn?: string }> = ({ basedOn }) => {
  const t = useT();
  const [tab, setTab] = useState<Tab>('describe');
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'describe', label: t('flows_new_tab_describe', 'Describe it') },
    { key: 'learn', label: t('flows_new_tab_learn', 'Learn from videos') },
  ];
  return (
    <div className="flex flex-col gap-[16px] w-[min(640px,90vw)]">
      <div className="text-[13px] leading-[1.5] text-textItemBlur">
        {t(
          'flows_new_intro',
          'Your agent makes custom flows. Say what you want here, copy the prompt and paste it into your agent.'
        )}
      </div>
      <div
        className="flex items-center gap-[6px]"
        role="tablist"
        aria-label={t('flows_mine_new', 'New custom flow')}
      >
        {tabs.map((one) => {
          const active = tab === one.key;
          return (
            <button
              key={one.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(one.key)}
              className={`h-[32px] px-[12px] rounded-[8px] text-[13px] font-[500] transition-colors border ${
                active
                  ? 'bg-tealSoft text-tealText border-tealText'
                  : 'border-newTableBorder text-textItemBlur hover:text-newTextColor hover:border-tealText'
              }`}
            >
              {one.label}
            </button>
          );
        })}
      </div>
      {/* Both stay mounted, so switching tabs keeps what was typed. */}
      <div
        role="tabpanel"
        className={tab === 'describe' ? 'flex flex-col gap-[16px]' : 'hidden'}
      >
        <DescribeTab basedOn={basedOn} />
      </div>
      <div
        role="tabpanel"
        className={tab === 'learn' ? 'flex flex-col gap-[16px]' : 'hidden'}
      >
        <LearnTab />
      </div>
    </div>
  );
};

// Opens the "New custom flow" dialog, optionally based on a flow.
export const useOpenNewCustomFlow = () => {
  const modals = useModals();
  const t = useT();
  return useCallback(
    (basedOn?: string) =>
      modals.openModal({
        title: t('flows_mine_new', 'New custom flow'),
        withCloseButton: true,
        children: <NewCustomFlow basedOn={basedOn} />,
      }),
    [modals, t]
  );
};
