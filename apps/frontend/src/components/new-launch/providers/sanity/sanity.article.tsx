'use client';

import { FC } from 'react';
import clsx from 'clsx';

export type SanitySpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
};

export type SanityBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; spans: SanitySpan[] }
  | { kind: 'quote'; spans: SanitySpan[] }
  | { kind: 'list'; ordered: boolean; items: SanitySpan[][] }
  | { kind: 'image'; url: string; alt?: string; caption?: string }
  | { kind: 'callout'; style: string; text: string }
  | { kind: 'embed'; provider: string; url: string; caption?: string };

// Callout styles a schema tends to use, and how they should read.
const CALLOUT_TONE: Record<string, string> = {
  warning: 'border-amber-500/60 bg-amber-500/10',
  caution: 'border-amber-500/60 bg-amber-500/10',
  error: 'border-red-500/60 bg-red-500/10',
  danger: 'border-red-500/60 bg-red-500/10',
  tip: 'border-emerald-500/60 bg-emerald-500/10',
  success: 'border-emerald-500/60 bg-emerald-500/10',
};

const Spans: FC<{ spans: SanitySpan[] }> = ({ spans }) => (
  <>
    {spans.map((span, index) => {
      const content = (
        <span
          key={index}
          className={clsx(
            span.bold && 'font-[700]',
            span.italic && 'italic',
            span.code &&
              'font-mono text-[13px] px-[4px] py-[1px] rounded-[4px] bg-newTableBorder'
          )}
        >
          {span.text}
        </span>
      );

      return span.href ? (
        <a
          key={index}
          href={span.href}
          target="_blank"
          rel="noreferrer"
          className="underline text-forth"
        >
          {content}
        </a>
      ) : (
        content
      );
    })}
  </>
);

/**
 * The article as it will appear once published: headings, lists, the images
 * that carry the argument, callouts and embeds. A reviewer approving a post
 * needs to see the thing itself, not a summary of it - so anything the body
 * contains is drawn here rather than flattened away.
 */
export const SanityArticle: FC<{ blocks: SanityBlock[] }> = ({ blocks }) => {
  if (!blocks?.length) {
    return null;
  }

  return (
    <div className="flex flex-col gap-[14px] text-[15px] leading-[1.65] text-textColor/90">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <div
                key={index}
                className={clsx(
                  'font-[700] text-textColor pt-[8px]',
                  block.level <= 2 ? 'text-[19px]' : 'text-[16px]'
                )}
              >
                {block.text}
              </div>
            );

          case 'quote':
            return (
              <blockquote
                key={index}
                className="border-s-[3px] border-forth ps-[14px] italic text-textColor/80"
              >
                <Spans spans={block.spans} />
              </blockquote>
            );

          case 'list':
            return (
              <ul
                key={index}
                className={clsx(
                  'flex flex-col gap-[6px] ps-[22px]',
                  block.ordered ? 'list-decimal' : 'list-disc'
                )}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Spans spans={item} />
                  </li>
                ))}
              </ul>
            );

          case 'image':
            return (
              <figure key={index} className="flex flex-col gap-[6px]">
                <img
                  src={block.url}
                  alt={block.alt || ''}
                  loading="lazy"
                  className="w-full rounded-[10px] border border-newTableBorder"
                />
                {!!block.caption && (
                  <figcaption className="text-[12px] text-textColor/55">
                    {block.caption}
                  </figcaption>
                )}
              </figure>
            );

          case 'callout':
            return (
              <div
                key={index}
                className={clsx(
                  'rounded-[8px] border p-[12px] text-[14px]',
                  CALLOUT_TONE[block.style] ||
                    'border-forth/50 bg-forth/10'
                )}
              >
                <div className="text-[11px] uppercase tracking-[0.08em] text-textColor/50 pb-[4px]">
                  {block.style}
                </div>
                {block.text}
              </div>
            );

          case 'embed':
            return (
              <a
                key={index}
                href={block.url}
                target="_blank"
                rel="noreferrer"
                className="flex flex-col gap-[4px] rounded-[8px] border border-newTableBorder p-[12px] hover:border-forth"
              >
                <div className="text-[11px] uppercase tracking-[0.08em] text-textColor/50">
                  {block.provider}
                </div>
                <div className="text-[14px] text-textColor/85">
                  {block.caption || block.url}
                </div>
              </a>
            );

          default:
            return (
              <p key={index}>
                <Spans spans={(block as any).spans || []} />
              </p>
            );
        }
      })}
    </div>
  );
};
