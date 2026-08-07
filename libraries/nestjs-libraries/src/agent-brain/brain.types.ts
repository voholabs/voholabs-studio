// Types for the agent brain. Kept free of any runtime dependency so this file can
// be imported from the frontend bundle as well as from the backend.

export type BrainCategoryId =
  | 'foundation'
  | 'sources'
  | 'channels'
  | 'experience';

// static      — a fixed list of documents defined in the registry
// integration — one document per connected channel, from a template
// user        — documents the user creates and names themselves
export type BrainCategorySource = 'static' | 'integration' | 'user';

// Optional capabilities a document can opt into on top of its blocks.
export type BrainDocumentFeature = 'links' | 'assets';

export interface BrainDocumentDef {
  key: string;
  labelKey: string;
  label: string;
  descriptionKey?: string;
  description?: string;
  // Name resolved against the icon set in the frontend; keeps the artwork out
  // of the registry while still being driven by it.
  icon: string;
  features?: readonly BrainDocumentFeature[];
}

export interface BrainCategoryDef {
  id: BrainCategoryId;
  labelKey: string;
  label: string;
  source: BrainCategorySource;
  // What the tree says when the category holds nothing yet. Each one has its
  // own reason for being empty, so each says its own thing.
  emptyKey?: string;
  empty?: string;
  // Present when source is 'static'.
  documents?: readonly BrainDocumentDef[];
  // Present when source is 'integration' or 'user'.
  documentTemplate?: BrainDocumentDef;
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
export interface BrainBlock {
  id: string;
  heading: string;
  // HTML
  body: string;
}

// A file the brand owns — a logo, a product shot, a video — stored in the same
// place as everything else the app uploads, with a note on when to use it.
export interface BrainAsset {
  id: string;
  name: string;
  // Path returned by the media upload, resolved against the storage host.
  url: string;
  mime?: string;
  note?: string;
}

export interface BrainLink {
  id: string;
  url: string;
  note?: string;
}

export interface BrainDocumentContent {
  v: 1;
  // Only set for documents the user named themselves.
  title?: string;
  blocks: BrainBlock[];
  links?: BrainLink[];
  assets?: BrainAsset[];
}

export interface BrainDocument {
  category: BrainCategoryId;
  key: string;
  content: BrainDocumentContent;
  updatedAt?: string;
}
