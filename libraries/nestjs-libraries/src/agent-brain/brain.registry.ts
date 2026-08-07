import {
  BrainCategoryDef,
  BrainCategoryId,
  BrainDocumentContent,
  BrainDocumentDef,
  BrainDocumentFeature,
} from '@gitroom/nestjs-libraries/agent-brain/brain.types';

// The single source of truth for the agent brain. The tree, the breadcrumbs, the
// icons, the editors and the API validation are all derived from this file, so
// adding a category or a document is a change here and nowhere else.
//
// The one rule: `key` values are permanent. They are the keys the stored content
// is written under, so renaming one orphans everything already written. Labels,
// descriptions, icons and ordering can change freely.

export const BRAIN_REGISTRY_VERSION = 3;

export const BRAIN_HEADING_MAX = 300;
export const BRAIN_BODY_MAX = 50_000;
export const BRAIN_TITLE_MAX = 200;
export const BRAIN_BLOCK_ID_MAX = 64;
export const BRAIN_BLOCKS_MAX = 200;
export const BRAIN_LINKS_MAX = 200;
export const BRAIN_LINK_ID_MAX = 64;
export const BRAIN_LINK_URL_MAX = 2048;
export const BRAIN_LINK_NOTE_MAX = 20_000;
export const BRAIN_ASSETS_MAX = 200;
export const BRAIN_ASSET_NAME_MAX = 300;
export const BRAIN_ASSET_URL_MAX = 2048;
export const BRAIN_ASSET_NOTE_MAX = 20_000;
export const BRAIN_USER_DOCUMENTS_MAX = 100;

// Client-side timings, kept beside the caps so nothing is a magic number at the
// call site.
export const BRAIN_AUTOSAVE_MS = 1500;
export const BRAIN_SAVED_INDICATOR_MS = 2500;
export const BRAIN_SAVE_TIMEOUT_MS = 20_000;

const FOUNDATION: readonly BrainDocumentDef[] = [
  {
    key: 'north-star',
    labelKey: 'brain_north_star',
    label: 'North Star',
    descriptionKey: 'brain_north_star_description',
    description: 'What the company is working toward, and what matters most now.',
    icon: 'compass',
  },
  {
    key: 'business-basics',
    labelKey: 'brain_business_basics',
    label: 'Business basics',
    descriptionKey: 'brain_business_basics_description',
    description:
      'What you do, what you sell, and the action you want people to take.',
    icon: 'briefcase',
  },
  {
    // The key stays 'icp' — renaming it would orphan everything already written.
    key: 'icp',
    labelKey: 'brain_icp',
    label: 'Ideal Customer Profile',
    descriptionKey: 'brain_icp_description',
    description: 'Who you are for.',
    icon: 'target',
  },
  {
    key: 'competitors',
    labelKey: 'brain_competitors',
    label: 'Competitors',
    descriptionKey: 'brain_competitors_description',
    description:
      'Who you are measured against, how you differ, and who is never named.',
    icon: 'flag',
  },
  {
    key: 'glossary',
    labelKey: 'brain_glossary',
    label: 'Glossary',
    descriptionKey: 'brain_glossary_description',
    description: 'Your house terms, product names, and what each one means.',
    icon: 'book',
  },
  {
    // The key stays 'voice'; only the label changed.
    key: 'voice',
    labelKey: 'brain_voice',
    label: 'Tone of voice',
    descriptionKey: 'brain_voice_description',
    description: 'How you sound.',
    icon: 'waveform',
  },
  {
    key: 'branding-assets',
    labelKey: 'brain_branding_assets',
    label: 'Branding & assets',
    descriptionKey: 'brain_branding_assets_description',
    description: 'How you look: logo, colours, type, and imagery.',
    icon: 'palette',
    features: ['assets'],
  },
  {
    key: 'boundaries',
    labelKey: 'brain_boundaries',
    label: 'Boundaries',
    descriptionKey: 'brain_boundaries_description',
    description: 'What the agent must never say, claim, or touch.',
    icon: 'shield',
  },
  {
    key: 'tasks',
    labelKey: 'brain_tasks',
    label: 'Tasks',
    descriptionKey: 'brain_tasks_description',
    description:
      'How often you post, the content mix, and how much the agent may publish alone.',
    icon: 'checklist',
  },
  {
    key: 'additional-info',
    labelKey: 'brain_additional_info',
    label: 'Additional info',
    descriptionKey: 'brain_additional_info_description',
    description: 'Anything else the agent should know.',
    icon: 'note',
  },
];

// Sources are created and named by the user, so the template describes any of
// them rather than a fixed document.
const SOURCE_TEMPLATE: BrainDocumentDef = {
  key: 'source',
  labelKey: 'brain_source',
  label: 'Source',
  descriptionKey: 'brain_source_description',
  description: 'Links the agent can draw on, and how to use them.',
  icon: 'link',
  features: ['links'],
};

// What the agent has worked out for itself over time — what landed, what fell
// flat, what this brand's audience responds to. The agent maintains it.
const EXPERIENCE_TEMPLATE: BrainDocumentDef = {
  key: 'experience',
  labelKey: 'brain_experience_entry',
  label: 'Experience',
  descriptionKey: 'brain_experience_entry_description',
  description: 'What the agent has learned works for this brand.',
  icon: 'spark',
};

// One document per connected channel. Nothing here branches on the provider.
const CHANNEL_TEMPLATE: BrainDocumentDef = {
  key: 'channel',
  labelKey: 'brain_channel',
  label: 'Channel',
  descriptionKey: 'brain_channel_description',
  description: 'How this account steers the Foundation for this channel.',
  icon: 'channel',
};

export const BRAIN_REGISTRY: readonly BrainCategoryDef[] = [
  {
    id: 'foundation',
    labelKey: 'brain_foundation',
    label: 'Foundation',
    source: 'static',
    documents: FOUNDATION,
  },
  {
    id: 'sources',
    labelKey: 'brain_sources',
    label: 'Sources',
    source: 'user',
    emptyKey: 'brain_sources_empty',
    empty: 'Add + sources agent should draw on',
    documentTemplate: SOURCE_TEMPLATE,
    canCreate: true,
    canDelete: true,
  },
  {
    id: 'experience',
    labelKey: 'brain_experience',
    label: 'Experience',
    source: 'user',
    emptyKey: 'brain_experience_empty',
    empty: 'Fills in as agent learns',
    documentTemplate: EXPERIENCE_TEMPLATE,
    // The agent writes this one; people read it.
    agentManaged: true,
    readOnly: true,
  },
  {
    id: 'channels',
    labelKey: 'brain_channel_preferences',
    label: 'Channel Preferences',
    source: 'integration',
    emptyKey: 'brain_no_channels',
    empty: 'Connect a channel to steer it here',
    documentTemplate: CHANNEL_TEMPLATE,
  },
];

export const findCategory = (
  categoryId: string
): BrainCategoryDef | undefined =>
  BRAIN_REGISTRY.find((category) => category.id === categoryId);

// Static categories address a document by key; the others resolve every key to
// the same template.
export const resolveDocumentDef = (
  categoryId: string,
  key: string
): BrainDocumentDef | undefined => {
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
  document: BrainDocumentDef,
  feature: BrainDocumentFeature
) => !!document.features?.includes(feature);

export const emptyContent = (): BrainDocumentContent => ({ v: 1, blocks: [] });

// A document counts as filled if any heading, body or link carries something.
export const isDocumentEmpty = (content?: BrainDocumentContent) => {
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

export const isReadOnly = (categoryId: string) =>
  !!findCategory(categoryId)?.readOnly;

export const isAgentManaged = (categoryId: string) =>
  !!findCategory(categoryId)?.agentManaged;

export const isBrainCategoryId = (value: string): value is BrainCategoryId =>
  BRAIN_REGISTRY.some((category) => category.id === value);
