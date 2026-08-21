'use client';

import { FC, useCallback, useMemo } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type ReactNodeViewProps,
} from '@tiptap/react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import removeMd from 'remove-markdown';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/**
 * `(post:<id>)` in a post's content is swapped for the referenced post's live
 * URL when this post publishes. Left as raw text it reads like a bug, so in the
 * editor it is drawn as a chip naming the post it points at.
 *
 * The chip is a node view only. `renderHTML` still writes the literal
 * `(post:<id>)` inside the span, because that exact text is what the backend
 * looks for at publish time - the span itself is stripped before the content
 * reaches any provider.
 */
export const POST_REFERENCE_REGEX = /\(post:([a-zA-Z0-9-_]+)\)/g;

const PostReferenceChip: FC<ReactNodeViewProps> = ({ node }) => {
  const postId = node.attrs.postId as string;
  const t = useT();
  const lookup = useOldPostsLookup();
  const referenced = lookup(postId);

  const label = referenced
    ? t('link_to_post_on', 'link to post on') +
      ' ' +
      (referenced.integration?.name || referenced.integration?.providerIdentifier)
    : t('link_to_a_post', 'link to a post');

  // Everything we know about the target, for the hover.
  const title = useMemo(() => {
    if (!referenced) {
      return t(
        'post_reference_unresolved',
        'This links to a post that is not on the calendar before this one. It will not resolve.'
      );
    }

    return [
      removeMd(referenced.content || '').slice(0, 160),
      '',
      `${referenced.integration?.name} · ${referenced.integration?.providerIdentifier}`,
      `${dayjs(referenced.publishDate).format('DD/MM/YYYY HH:mm')} · ${
        referenced.state
      }`,
      '',
      referenced.releaseURL
        ? referenced.releaseURL.split(',')[0]
        : t(
            'post_reference_pending',
            'Not published yet - the link is filled in when it goes out.'
          ),
    ].join('\n');
  }, [referenced, t]);

  return (
    <NodeViewWrapper as="span" className="inline-block align-middle">
      <span
        data-tooltip-id="tooltip"
        data-tooltip-content={title}
        contentEditable={false}
        className={`select-none cursor-default inline-flex items-center gap-[6px] rounded-[6px] px-[8px] py-[1px] mx-[2px] text-[13px] border ${
          referenced
            ? 'bg-newColColor border-newTextColor/20'
            : 'bg-red-500/10 border-red-500/40'
        }`}
      >
        {referenced?.integration?.providerIdentifier && (
          <img
            className="w-[14px] h-[14px] rounded-full"
            src={`/icons/platforms/${referenced.integration.providerIdentifier}.png`}
            alt=""
          />
        )}
        <span>{label}</span>
      </span>
    </NodeViewWrapper>
  );
};

/**
 * Resolves references against the same "posts before this one" list the picker
 * uses, so the picker, every chip, and the preview all share one request.
 */
export const useOldPostsLookup = () => {
  const fetch = useFetch();
  const date = useLaunchStore((state) => state.date);
  const key = date.utc().format('YYYY-MM-DDTHH:mm:00');
  const { data } = useSWR('old-posts-' + key, () =>
    fetch('/posts/old?date=' + key, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }).then((res) => res.json())
  );

  return useCallback(
    (postId: string) => (data || []).find((p: any) => p.id === postId),
    [data]
  );
};

/**
 * What the reference will actually turn into when the post goes out: the
 * referenced post's live URL if it already has one, otherwise a marker the
 * preview swaps for a chip, since the URL genuinely does not exist yet.
 */
export const PREVIEW_MARKER_OPEN = '{{{postref:';
export const PREVIEW_MARKER_CLOSE = '}}}';

export const resolvePostReferencesForPreview = (
  html: string,
  lookup: (postId: string) => any
) => {
  if (!html || html.indexOf('(post:') === -1) {
    return html;
  }

  return unwrapPostReferences(html).replace(POST_REFERENCE_REGEX, (_, id) => {
    const referenced = lookup(id);
    const url = (referenced?.releaseURL || '').split(',')[0].trim();
    if (url) {
      return url;
    }

    const name =
      referenced?.integration?.name ||
      referenced?.integration?.providerIdentifier;

    return `${PREVIEW_MARKER_OPEN}link to the ${
      name ? name + ' ' : ''
    }post${PREVIEW_MARKER_CLOSE}`;
  });
};

const unwrapPostReferences = (html: string) =>
  html.replace(
    /<span[^>]*data-post-id="[^"]*"[^>]*>(\(post:[a-zA-Z0-9-_]+\))<\/span>/g,
    '$1'
  );

export const PostReference = Node.create({
  name: 'postReference',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      postId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-post-id'),
        renderHTML: (attributes) => ({ 'data-post-id': attributes.postId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-post-id]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    // The literal text matters - it is what resolves to a URL at publish time.
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'post-reference' }),
      `(post:${node.attrs.postId})`,
    ];
  },

  renderText({ node }) {
    return `(post:${node.attrs.postId})`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(PostReferenceChip);
  },
});

/**
 * Wraps bare `(post:<id>)` text so it loads as a chip. Content written by the
 * agent over MCP, or by an older version of the editor, arrives as plain text -
 * without this it would stay raw in the editor even though it works fine.
 */
export const markPostReferences = (html: string) => {
  if (!html || html.indexOf('(post:') === -1) {
    return html;
  }

  // Unwrap first, so content that is already marked up doesn't end up nested.
  return unwrapPostReferences(html).replace(
    POST_REFERENCE_REGEX,
    (match, id) => `<span data-post-id="${id}">${match}</span>`
  );
};
