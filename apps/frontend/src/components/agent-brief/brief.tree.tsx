'use client';

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { BriefIcon } from '@gitroom/frontend/components/agent-brief/brief.icons';
import { categoryHint } from '@gitroom/nestjs-libraries/agent-brief/brief.registry';
import {
  BriefTreeDocument,
  BriefTreeGroup,
} from '@gitroom/frontend/components/agent-brief/use.brief.tree';

const Chevron: FC<{ open: boolean }> = ({ open }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    className={clsx('transition-transform', open ? 'rotate-90' : 'rtl:rotate-180')}
  >
    <path
      d="M6 3.33333L10.6667 8L6 12.6667"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// The names here are one word each, and one word cannot say what belongs in a
// section. The explanation hangs off a hover rather than sitting on the page,
// because it is read once and then in the way forever.
const Hint: FC<{ content: string }> = ({ content }) => (
  <span
    data-tooltip-id="tooltip"
    data-tooltip-content={content}
    // Without a width the tooltip lays a paragraph out as a single line that
    // runs off the screen.
    data-tooltip-class-name="!max-w-[280px] !whitespace-normal !leading-[1.5]"
    className="shrink-0 cursor-help text-textItemBlur hover:text-warm transition-colors"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.4v3.4" />
      <path d="M8 5.2v.1" />
    </svg>
  </span>
);

const TreeRow: FC<{
  document: BriefTreeDocument;
  active: boolean;
  filled: boolean;
  onSelect: (document: BriefTreeDocument) => void;
}> = ({ document, active, filled, onSelect }) => (
  <div
    onClick={() => onSelect(document)}
    className={clsx(
      'relative cursor-pointer select-none flex items-center gap-[10px] h-[36px] ps-[14px] pe-[10px] rounded-e-[8px] transition-colors',
      active ? 'bg-warmSoft' : 'hover:bg-warmHover'
    )}
  >
    {/* Sized to the row rather than to a fixed-height graphic, so it can never
        run past the row it belongs to. */}
    <span
      className={clsx(
        'absolute start-0 top-0 h-full w-[3px] rounded-e-[3px] bg-warm transition-opacity',
        active ? 'opacity-100' : 'opacity-0'
      )}
    />
    {/* A fixed slot, so a 16px document icon and a 20px avatar start their
        labels in the same place and the platform badge overhangs into the gap
        instead of widening the row. */}
    <span
      className={clsx(
        'relative shrink-0 w-[20px] h-[20px] flex items-center justify-center',
        active ? 'text-warm' : 'text-textItemBlur'
      )}
    >
      {document.channel ? (
        <>
          <ImageWithFallback
            fallbackSrc={`/icons/platforms/${document.channel.identifier}.png`}
            src={document.channel.picture}
            className="rounded-[6px]"
            alt={document.channel.identifier}
            width={20}
            height={20}
          />
          {/* One person's page on two networks carries the same avatar and the
              same name, so the network is the only thing telling the rows
              apart. Always drawn: a channel with no avatar of its own gets the
              generic placeholder from the API rather than this logo, so the
              badge is the only network mark those rows will ever have. */}
          <SafeImage
            src={`/icons/platforms/${document.channel.identifier}.png`}
            className="rounded-[4px] absolute -bottom-[3px] -end-[4px] border border-fifth bg-newBgColorInner"
            alt={document.channel.identifier}
            width={12}
            height={12}
          />
        </>
      ) : (
        <BriefIcon name={document.icon} />
      )}
    </span>
    <span
      className={clsx(
        'flex-1 text-[14px] whitespace-nowrap text-ellipsis overflow-hidden',
        active && 'font-[500]',
        document.channel?.disabled && 'opacity-50'
      )}
    >
      {document.label}
    </span>
    {filled && <span className="w-[6px] h-[6px] rounded-full bg-warm shrink-0" />}
  </div>
);

export const BriefTree: FC<{
  groups: BriefTreeGroup[];
  active?: BriefTreeDocument;
  isFilled: (document: BriefTreeDocument) => boolean;
  onSelect: (document: BriefTreeDocument) => void;
  onCreate: (group: BriefTreeGroup) => void;
}> = ({ groups, active, isFilled, onSelect, onCreate }) => {
  const t = useT();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  // The search box in the header is the page's primary control, so it takes the
  // usual shortcut for one.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return groups;
    }

    return groups
      .map((group) => ({
        ...group,
        documents: group.documents.filter((document) =>
          document.label.toLowerCase().includes(query)
        ),
      }))
      .filter((group) => group.documents.length);
  }, [groups, search]);

  const toggle = useCallback(
    (id: string) => () =>
      setCollapsed((current) => ({ ...current, [id]: !current[id] })),
    []
  );

  return (
    <>
      <div className="flex items-center gap-[10px] mb-[16px]">
        <span className="text-warm">
          <BriefIcon name="compass" size={22} />
        </span>
        <h2 className="text-[20px] font-[500]">
          {t('brief_title', 'Agent Brief')}
        </h2>
        <Hint
          content={t(
            'brief_title_tooltip',
            'What the agent knows about your business. It reads this before writing anything. Quicker to have the agent fill it in, or your own tools over MCP, than to type it yourself.'
          )}
        />
      </div>

      <div className="flex items-center gap-[8px] h-[38px] px-[12px] mb-[16px] rounded-[8px] border border-newTableBorder focus-within:border-warm transition-colors">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className="text-textItemBlur shrink-0"
        >
          <path
            d="M14 14L10.5 10.5M12 7.33333C12 9.91066 9.91066 12 7.33333 12C4.75601 12 2.66667 9.91066 2.66667 7.33333C2.66667 4.75601 4.75601 2.66667 7.33333 2.66667C9.91066 2.66667 12 4.75601 12 7.33333Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('brief_search_placeholder', 'Search files...')}
          className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-textItemBlur"
        />
      </div>

      <div className="flex flex-col gap-[14px]">
        {filtered.map((group) => (
          <div key={group.category.id} className="flex flex-col gap-[4px]">
            <div className="flex items-center gap-[8px] pe-[10px]">
              <div
                onClick={toggle(group.category.id)}
                className="flex-1 cursor-pointer select-none flex items-center gap-[8px] text-[13px] font-[500] text-textItemBlur"
              >
                <Chevron open={!collapsed[group.category.id]} />
                {group.label}
              </div>
              {(() => {
                const hint = categoryHint(group.category);
                return hint ? (
                  <Hint content={t(hint.key, hint.text)} />
                ) : null;
              })()}
              {group.category.canCreate && (
                <div
                  onClick={() => onCreate(group)}
                  data-tooltip-id="tooltip"
                  data-tooltip-content={t('brief_add_document', 'Add document')}
                  className="cursor-pointer select-none w-[20px] h-[20px] rounded-[6px] flex items-center justify-center text-textItemBlur hover:text-warm hover:bg-warmHover transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <path
                      d="M8 3.33333V12.6667M3.33333 8H12.6667"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}
            </div>
            {!collapsed[group.category.id] && (
              <div className="flex flex-col">
                {group.documents.map((document) => (
                  <TreeRow
                    key={`${group.category.id}-${document.key}`}
                    document={document}
                    active={
                      active?.category.id === group.category.id &&
                      active?.key === document.key
                    }
                    filled={isFilled(document)}
                    onSelect={onSelect}
                  />
                ))}
                {!group.documents.length && !!group.category.emptyKey && (
                  <div className="ps-[14px] py-[6px] text-[13px] text-textItemBlur">
                    {t(group.category.emptyKey, group.category.empty!)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {!filtered.length && (
          <div className="text-[13px] text-textItemBlur">
            {t('brief_no_results', 'No matches')}
          </div>
        )}
      </div>
    </>
  );
};
