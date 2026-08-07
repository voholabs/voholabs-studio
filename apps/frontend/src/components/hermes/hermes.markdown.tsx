'use client';

import { FC, Fragment, ReactNode } from 'react';

// A small renderer for the markdown an agent actually produces: headings,
// lists, code, emphasis and links. It builds React nodes rather than HTML, so
// nothing the agent returns can inject markup.

const INLINE =
  /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g;

const safeHref = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.href
      : undefined;
  } catch (err) {
    return undefined;
  }
};

const renderInline = (text: string, keyPrefix: string): ReactNode[] =>
  text.split(INLINE).map((piece, index) => {
    const key = `${keyPrefix}-${index}`;

    if (!piece) {
      return null;
    }

    if (
      (piece.startsWith('**') && piece.endsWith('**')) ||
      (piece.startsWith('__') && piece.endsWith('__'))
    ) {
      return (
        <strong key={key} className="font-[600]">
          {piece.slice(2, -2)}
        </strong>
      );
    }

    if (
      (piece.startsWith('*') && piece.endsWith('*') && piece.length > 2) ||
      (piece.startsWith('_') && piece.endsWith('_') && piece.length > 2)
    ) {
      return <em key={key}>{piece.slice(1, -1)}</em>;
    }

    if (piece.startsWith('`') && piece.endsWith('`')) {
      return (
        <code
          key={key}
          className="px-[5px] py-[1px] rounded-[4px] bg-newColColor text-[13px] font-mono"
        >
          {piece.slice(1, -1)}
        </code>
      );
    }

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece);
    if (link) {
      const href = safeHref(link[2]);
      return href ? (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-warm underline"
        >
          {link[1]}
        </a>
      ) : (
        <Fragment key={key}>{link[1]}</Fragment>
      );
    }

    if (/^https?:\/\//.test(piece)) {
      const href = safeHref(piece);
      return href ? (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-warm underline break-all"
        >
          {piece}
        </a>
      ) : (
        <Fragment key={key}>{piece}</Fragment>
      );
    }

    return <Fragment key={key}>{piece}</Fragment>;
  });

export const HermesMarkdown: FC<{ text: string }> = ({ text }) => {
  const lines = (text || '').split('\n');
  const blocks: ReactNode[] = [];

  // `start` keeps the numbering the agent used: a numbered item separated from
  // the next by a paragraph is its own list, and without this every one of them
  // would restart at 1.
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  let code: { language: string; lines: string[] } | null = null;

  const closeList = () => {
    if (!list) {
      return;
    }

    const { ordered, items, start } = list;
    const key = `list-${blocks.length}`;
    blocks.push(
      ordered ? (
        <ol
          key={key}
          start={start}
          className="list-decimal ps-[22px] flex flex-col gap-[4px]"
        >
          {items.map((item, index) => (
            <li key={index}>{renderInline(item, `${key}-${index}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="list-disc ps-[22px] flex flex-col gap-[4px]">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item, `${key}-${index}`)}</li>
          ))}
        </ul>
      )
    );
    list = null;
  };

  lines.forEach((line, index) => {
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      if (code) {
        blocks.push(
          <pre
            key={`code-${index}`}
            className="rounded-[8px] bg-newBgColor border border-newTableBorder p-[12px] overflow-x-auto text-[13px] font-mono"
          >
            <code>{code.lines.join('\n')}</code>
          </pre>
        );
        code = null;
      } else {
        closeList();
        code = { language: fence[1], lines: [] };
      }
      return;
    }

    if (code) {
      code.lines.push(line);
      return;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      blocks.push(
        <div
          key={`h-${index}`}
          className={
            level <= 2
              ? 'text-[17px] font-[600] mt-[6px]'
              : 'text-[15px] font-[600] mt-[4px]'
          }
        >
          {renderInline(heading[2], `h-${index}`)}
        </div>
      );
      return;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (list?.ordered) {
        closeList();
      }
      list = list || { ordered: false, start: 1, items: [] };
      list.items.push(bullet[1]);
      return;
    }

    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (list && !list.ordered) {
        closeList();
      }
      list = list || {
        ordered: true,
        start: Number(numbered[1]) || 1,
        items: [],
      };
      list.items.push(numbered[2]);
      return;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      blocks.push(
        <div
          key={`q-${index}`}
          className="border-s-[3px] border-warm ps-[10px] opacity-90"
        >
          {renderInline(quote[1], `q-${index}`)}
        </div>
      );
      return;
    }

    closeList();

    if (!line.trim()) {
      return;
    }

    blocks.push(
      <p key={`p-${index}`}>{renderInline(line, `p-${index}`)}</p>
    );
  });

  closeList();

  if (code) {
    // An unterminated fence still has to show what it captured.
    blocks.push(
      <pre
        key="code-open"
        className="rounded-[8px] bg-newBgColor border border-newTableBorder p-[12px] overflow-x-auto text-[13px] font-mono"
      >
        <code>{code.lines.join('\n')}</code>
      </pre>
    );
  }

  return <div className="flex flex-col gap-[10px]">{blocks}</div>;
};
