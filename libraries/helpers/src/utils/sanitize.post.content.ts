import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'u',
  'a',
  'ul',
  'li',
  'h1',
  'h2',
  'h3',
  'span',
];

const ALLOWED_ATTR = [
  'href',
  'target',
  'rel',
  'class',
  'data-mention-id',
  'data-mention-label',
];

const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|\/|#)/i;

export const sanitizePostContent = (value: unknown): string => {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
  });
};

// The editor previews wrap post content in a little markup of their own: the
// cropped-text highlight (<mark> with a tooltip) and coloured mention chips.
// Same allowlist as stored content, plus exactly that markup.
const PREVIEW_ALLOWED_TAGS = [...ALLOWED_TAGS, 'mark', 'ol', 'em', 'b', 'i'];

const PREVIEW_ALLOWED_ATTR = [
  ...ALLOWED_ATTR,
  'style',
  'data-tooltip-id',
  'data-tooltip-content',
  'data-post-id',
];

// The only inline style the previews write is a mention chip's text colour.
const PREVIEW_STYLE = /^\s*color:\s*#[0-9a-f]{3,8}\s*;?\s*$/i;

const keepOnlyPreviewStyle = (_node: Element, data: any) => {
  if (data?.attrName === 'style' && !PREVIEW_STYLE.test(data.attrValue || '')) {
    data.keepAttr = false;
  }
};

export const sanitizePreviewHtml = (value: unknown): string => {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  DOMPurify.addHook('uponSanitizeAttribute', keepOnlyPreviewStyle);
  try {
    return DOMPurify.sanitize(value, {
      ALLOWED_TAGS: PREVIEW_ALLOWED_TAGS,
      ALLOWED_ATTR: PREVIEW_ALLOWED_ATTR,
      // DOMPurify's default URI check (still no javascript: or data: links).
      // The stricter stored-content regexp also rejects non-URL values such
      // as target="_blank", which a preview link needs so a click does not
      // navigate away from the editor.
    });
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', keepOnlyPreviewStyle);
  }
};
