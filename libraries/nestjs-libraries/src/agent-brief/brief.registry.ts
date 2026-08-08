import {
  BriefCategoryDef,
  BriefCategoryId,
  BriefDocumentContent,
  BriefDocumentDef,
  BriefDocumentFeature,
} from '@gitroom/nestjs-libraries/agent-brief/brief.types';

// The single source of truth for the agent brief. The tree, the breadcrumbs, the
// icons, the editors and the API validation are all derived from this file, so
// adding a category or a document is a change here and nowhere else.
//
// The one rule: `key` values are permanent. They are the keys the stored content
// is written under, so renaming one orphans everything already written. Labels,
// descriptions, icons and ordering can change freely.

export const BRIEF_REGISTRY_VERSION = 3;

export const BRIEF_HEADING_MAX = 300;
export const BRIEF_BODY_MAX = 50_000;
export const BRIEF_TITLE_MAX = 200;
export const BRIEF_BLOCK_ID_MAX = 64;
export const BRIEF_BLOCKS_MAX = 200;
export const BRIEF_LINKS_MAX = 200;
export const BRIEF_LINK_ID_MAX = 64;
export const BRIEF_LINK_URL_MAX = 2048;
export const BRIEF_LINK_NOTE_MAX = 20_000;
export const BRIEF_ASSETS_MAX = 200;
export const BRIEF_ASSET_NAME_MAX = 300;
export const BRIEF_ASSET_URL_MAX = 2048;
export const BRIEF_ASSET_NOTE_MAX = 20_000;
export const BRIEF_USER_DOCUMENTS_MAX = 100;

// Client-side timings, kept beside the caps so nothing is a magic number at the
// call site.
export const BRIEF_AUTOSAVE_MS = 1500;
export const BRIEF_SAVED_INDICATOR_MS = 2500;
export const BRIEF_SAVE_TIMEOUT_MS = 20_000;

const FOUNDATION: readonly BriefDocumentDef[] = [
  {
    key: 'north-star',
    labelKey: 'brief_north_star',
    label: 'North Star',
    descriptionKey: 'brief_north_star_description',
    description: 'What the company is working toward, and what matters most now.',
    icon: 'compass',
  },
  {
    key: 'business-basics',
    labelKey: 'brief_business_basics',
    label: 'Business basics',
    descriptionKey: 'brief_business_basics_description',
    description:
      'What you do, what you sell, and the action you want people to take.',
    icon: 'briefcase',
  },
  {
    // The key stays 'icp' — renaming it would orphan everything already written.
    key: 'icp',
    labelKey: 'brief_icp',
    label: 'Ideal Customer Profile',
    descriptionKey: 'brief_icp_description',
    description: 'Who you are for.',
    icon: 'target',
  },
  {
    key: 'competitors',
    labelKey: 'brief_competitors',
    label: 'Competitors',
    descriptionKey: 'brief_competitors_description',
    description:
      'Who you are measured against, how you differ, and who is never named.',
    icon: 'flag',
  },
  {
    key: 'glossary',
    labelKey: 'brief_glossary',
    label: 'Glossary',
    descriptionKey: 'brief_glossary_description',
    description: 'Your house terms, product names, and what each one means.',
    icon: 'book',
  },
  {
    // The key stays 'voice'; only the label changed.
    key: 'voice',
    labelKey: 'brief_voice',
    label: 'Tone of voice',
    descriptionKey: 'brief_voice_description',
    description: 'How you sound.',
    icon: 'waveform',
  },
  {
    key: 'branding-assets',
    labelKey: 'brief_branding_assets',
    label: 'Branding & assets',
    descriptionKey: 'brief_branding_assets_description',
    description: 'How you look: logo, colours, type, and imagery.',
    icon: 'palette',
    features: ['assets'],
  },
  {
    key: 'boundaries',
    labelKey: 'brief_boundaries',
    label: 'Boundaries',
    descriptionKey: 'brief_boundaries_description',
    description: 'What the agent must never say, claim, or touch.',
    icon: 'shield',
  },
  {
    key: 'tasks',
    labelKey: 'brief_tasks',
    label: 'Tasks',
    descriptionKey: 'brief_tasks_description',
    description:
      'How often you post, the content mix, and how much the agent may publish alone.',
    icon: 'checklist',
  },
  {
    key: 'additional-info',
    labelKey: 'brief_additional_info',
    label: 'Additional info',
    descriptionKey: 'brief_additional_info_description',
    description: 'Anything else the agent should know.',
    icon: 'note',
  },
];

// Sources are created and named by the user, so the template describes any of
// them rather than a fixed document.
const SOURCE_TEMPLATE: BriefDocumentDef = {
  key: 'source',
  labelKey: 'brief_source',
  label: 'Source',
  descriptionKey: 'brief_source_description',
  description: 'Links the agent can draw on, and how to use them.',
  icon: 'link',
  features: ['links'],
};

// What the agent has worked out for itself over time — what landed, what fell
// flat, what this brand's audience responds to. The agent maintains it.
const EXPERIENCE_TEMPLATE: BriefDocumentDef = {
  key: 'experience',
  labelKey: 'brief_experience_entry',
  label: 'Experience',
  descriptionKey: 'brief_experience_entry_description',
  description: 'What the agent has learned works for this brand.',
  icon: 'spark',
};

// One document per connected channel. Nothing here branches on the provider.
const CHANNEL_TEMPLATE: BriefDocumentDef = {
  key: 'channel',
  labelKey: 'brief_channel',
  label: 'Channel',
  descriptionKey: 'brief_channel_description',
  description: 'How this account steers the Foundation for this channel.',
  icon: 'channel',
};

export const BRIEF_REGISTRY: readonly BriefCategoryDef[] = [
  {
    id: 'foundation',
    labelKey: 'brief_foundation',
    label: 'Foundation',
    source: 'static',
    tooltipKey: 'brief_foundation_tooltip',
    tooltip: 'The foundation of your content strategy across all channels.',
    documents: FOUNDATION,
  },
  {
    id: 'sources',
    labelKey: 'brief_sources',
    label: 'Sources',
    source: 'user',
    emptyKey: 'brief_sources_empty',
    empty: 'Add + sources agent should draw on',
    tooltipKey: 'brief_sources_tooltip',
    tooltip: 'Where agent should read more; Add + sources agent should draw on.',
    documentTemplate: SOURCE_TEMPLATE,
    canCreate: true,
    canDelete: true,
  },
  {
    id: 'experience',
    labelKey: 'brief_experience',
    label: 'Experience',
    source: 'user',
    emptyKey: 'brief_experience_empty',
    empty: 'Fills in as agent learns',
    tooltipKey: 'brief_experience_tooltip',
    tooltip: 'Fills in as agent learns; Agent keeps refining it.',
    documentTemplate: EXPERIENCE_TEMPLATE,
    // The agent fills this one in on its own, without being asked. People do
    // not have to touch it, but they can: the agent draws the wrong lesson
    // sometimes, and the only person who can tell is the one who knows the
    // business. Creating an entry is still the agent's job.
    agentManaged: true,
    canDelete: true,
  },
  {
    id: 'channels',
    labelKey: 'brief_channel_preferences',
    label: 'Channel Preferences',
    source: 'integration',
    emptyKey: 'brief_no_channels',
    empty: 'Connect a channel to steer it here',
    tooltipKey: 'brief_channel_preferences_tooltip',
    tooltip: 'Steer the foundation rules based on each channel.',
    documentTemplate: CHANNEL_TEMPLATE,
  },
];

export const findCategory = (
  categoryId: string
): BriefCategoryDef | undefined =>
  BRIEF_REGISTRY.find((category) => category.id === categoryId);

// Static categories address a document by key; the others resolve every key to
// the same template.
export const resolveDocumentDef = (
  categoryId: string,
  key: string
): BriefDocumentDef | undefined => {
  const category = findCategory(categoryId);
  if (!category) {
    return undefined;
  }

  if (category.source !== 'static') {
    return category.documentTemplate;
  }

  return category.documents?.find((document) => document.key === key);
};

export const documentHasFeature = (
  document: BriefDocumentDef,
  feature: BriefDocumentFeature
) => !!document.features?.includes(feature);

export const emptyContent = (): BriefDocumentContent => ({ v: 1, blocks: [] });

// A document counts as filled if any heading, body or link carries something.
export const isDocumentEmpty = (content?: BriefDocumentContent) => {
  if (!content) {
    return true;
  }

  // Links and files count as content in their own right: a document holding
  // only an uploaded logo is not empty.
  if (content.links?.length || content.assets?.length) {
    return false;
  }

  return !(content.blocks || []).some(
    (block) => !!block.heading?.trim() || !!stripHtml(block.body).trim()
  );
};

export const stripHtml = (value?: string) =>
  (value || '').replace(/<[^>]*>/g, ' ');

// Channel documents are keyed on the account itself rather than on the
// Integration row id, because reconnecting a channel creates a new row and the
// knowledge written about that account has to survive it.
export const channelDocumentKey = (
  providerIdentifier: string,
  internalId: string
) => `${providerIdentifier}:${internalId}`;

export const isAgentManaged = (categoryId: string) =>
  !!findCategory(categoryId)?.agentManaged;

export const isBriefCategoryId = (value: string): value is BriefCategoryId =>
  BRIEF_REGISTRY.some((category) => category.id === value);
