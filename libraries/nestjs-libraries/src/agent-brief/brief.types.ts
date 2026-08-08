// Types for the agent brief. Kept free of any runtime dependency so this file can
// be imported from the frontend bundle as well as from the backend.

export type BriefCategoryId =
  | 'foundation'
  | 'sources'
  | 'channels'
  | 'experience';

// static      — a fixed list of documents defined in the registry
// integration — one document per connected channel, from a template
// user        — documents the user creates and names themselves
export type BriefCategorySource = 'static' | 'integration' | 'user';

// Optional capabilities a document can opt into on top of its blocks.
export type BriefDocumentFeature = 'links' | 'assets';

export interface BriefDocumentDef {
  key: string;
  labelKey: string;
  label: string;
  descriptionKey?: string;
  description?: string;
  // Name resolved against the icon set in the frontend; keeps the artwork out
  // of the registry while still being driven by it.
  icon: string;
  features?: readonly BriefDocumentFeature[];
}

export interface BriefCategoryDef {
  id: BriefCategoryId;
  labelKey: string;
  label: string;
  source: BriefCategorySource;
  // What the tree says when the category holds nothing yet. Each one has its
  // own reason for being empty, so each says its own thing.
  emptyKey?: string;
  empty?: string;
  // Answers "what goes in here?" on hover. Four categories with one-word names
  // are not self-explanatory, and the alternative is prose on the page that
  // everyone reads once and then has to scroll past forever.
  tooltipKey?: string;
  tooltip?: string;
  // Present when source is 'static'.
  documents?: readonly BriefDocumentDef[];
  // Present when source is 'integration' or 'user'.
  documentTemplate?: BriefDocumentDef;
  // Only user-owned documents can be created and thrown away.
  canCreate?: boolean;
  canDelete?: boolean;
  // The agent keeps this category itself: it may add and refine rules here
  // without asking, because the content is its own notes rather than the
  // user's instructions.
  agentManaged?: boolean;
  // Shown to people but not editable by them — it exists so the agent's own
  // notes are visible rather than a black box.
  readOnly?: boolean;
}

// A heading and the text underneath it. This is the whole content model: the
// heading is the key, the body is the value.
export interface BriefBlock {
  id: string;
  heading: string;
  // HTML
  body: string;
}

// A file the brand owns — a logo, a product shot, a video — stored in the same
// place as everything else the app uploads, with a note on when to use it.
export interface BriefAsset {
  id: string;
  name: string;
  // Path returned by the media upload, resolved against the storage host.
  url: string;
  mime?: string;
  note?: string;
}

export interface BriefLink {
  id: string;
  url: string;
  note?: string;
}

export interface BriefDocumentContent {
  v: 1;
  // Only set for documents the user named themselves.
  title?: string;
  blocks: BriefBlock[];
  links?: BriefLink[];
  assets?: BriefAsset[];
}

export interface BriefDocument {
  category: BriefCategoryId;
  key: string;
  content: BriefDocumentContent;
  updatedAt?: string;
}
