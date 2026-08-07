'use client';

import { FC, useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  BRAIN_BLOCKS_MAX,
  BRAIN_HEADING_MAX,
  documentHasFeature,
  emptyContent,
  stripHtml,
} from '@gitroom/nestjs-libraries/agent-brain/brain.registry';
import {
  BrainBlock,
  BrainDocumentContent,
} from '@gitroom/nestjs-libraries/agent-brain/brain.types';
import { BrainTreeDocument } from '@gitroom/frontend/components/agent-brain/use.brain.tree';
import { useBrainAutosave } from '@gitroom/frontend/components/agent-brain/use.brain.autosave';
import { BrainTextarea } from '@gitroom/frontend/components/agent-brain/brain.textarea';
import { BrainSaveIndicator } from '@gitroom/frontend/components/agent-brain/brain.save.indicator';
import { BrainLinks } from '@gitroom/frontend/components/agent-brain/brain.links';
import { BrainAssets } from '@gitroom/frontend/components/agent-brain/brain.assets';
import {
  BRAIN_DOCUMENTS_KEY,
  BrainDocumentsResponse,
} from '@gitroom/frontend/components/agent-brain/use.brain.documents';

const PlusIcon: FC = () => (
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
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const TrashIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
  >
    <path
      d="M2 4H14M12.6667 4V13.3333C12.6667 14 12 14.6667 11.3333 14.6667H4.66667C4 14.6667 3.33333 14 3.33333 13.3333V4M5.33333 4V2.66667C5.33333 2 6 1.33333 6.66667 1.33333H9.33333C10 1.33333 10.6667 2 10.6667 2.66667V4"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// One shape, always. The button does not change size or style with the state of
// the document.
const ActionButton: FC<{
  label: string;
  onClick: () => void;
  icon: 'plus' | 'trash';
}> = ({ label, onClick, icon }) => (
  <div
    onClick={onClick}
    className="self-start cursor-pointer select-none flex items-center gap-[8px] rounded-[8px] border border-newTableBorder px-[14px] h-[38px] text-[14px] text-textItemBlur hover:border-warm hover:text-warm hover:bg-warmHover transition-colors"
  >
    {icon === 'plus' ? <PlusIcon /> : <TrashIcon />}
    {label}
  </div>
);

// Mounted with a key of category + document, so every document gets its own
// autosave controller.
export const BrainDocument: FC<{
  document: BrainTreeDocument;
  content?: BrainDocumentContent;
  onDeleted: () => void;
}> = ({ document, content, onDeleted }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { mutate } = useSWRConfig();

  const current = content || emptyContent();
  // Bodies written before this was plain text may still carry markup.
  const [blocks, setBlocks] = useState<BrainBlock[]>(() =>
    (current.blocks || []).map((block) =>
      /<[a-z][\s\S]*>/i.test(block.body)
        ? { ...block, body: stripHtml(block.body).replace(/\s+/g, ' ').trim() }
        : block
    )
  );
  const [title, setTitle] = useState(current.title || '');

  const { state, save, discardPending, retry } = useBrainAutosave(
    document.category.id,
    document.key
  );

  const hasLinks = documentHasFeature(document.definition, 'links');
  const hasAssets = documentHasFeature(document.definition, 'assets');
  const readOnly = !!document.category.readOnly;
  const canDelete = !!document.category.canDelete && !readOnly;
  const canRename = document.category.source === 'user' && !readOnly;

  const commitBlocks = useCallback(
    (next: BrainBlock[]) => {
      setBlocks(next);
      save({ blocks: next });
    },
    [save]
  );

  const addBlock = useCallback(
    () => commitBlocks([...blocks, { id: makeId(10), heading: '', body: '' }]),
    [blocks, commitBlocks]
  );

  const changeBlock = useCallback(
    (id: string, field: 'heading' | 'body', value: string) =>
      commitBlocks(
        blocks.map((block) =>
          block.id === id ? { ...block, [field]: value } : block
        )
      ),
    [blocks, commitBlocks]
  );

  const removeBlock = useCallback(
    (id: string) => () => commitBlocks(blocks.filter((b) => b.id !== id)),
    [blocks, commitBlocks]
  );

  const remove = useCallback(async () => {
    if (
      !(await deleteDialog(
        t('brain_delete_confirm', 'Delete this document and everything in it?'),
        t('brain_delete_document', 'Delete document')
      ))
    ) {
      return;
    }

    // Anything still buffered or in flight would write the content straight back.
    await discardPending();

    const response = await fetch(
      `/brain/${encodeURIComponent(
        document.category.id
      )}/${encodeURIComponent(document.key)}`,
      { method: 'DELETE' }
    );

    if (!response.ok) {
      toaster.show(t('brain_save_failed', 'Could not save'), 'warning');
      return;
    }

    mutate<BrainDocumentsResponse>(
      BRAIN_DOCUMENTS_KEY,
      (documents) =>
        documents && {
          ...documents,
          documents: documents.documents.filter(
            (one) =>
              one.category !== document.category.id || one.key !== document.key
          ),
        },
      { revalidate: false }
    );

    onDeleted();
  }, [
    fetch,
    mutate,
    t,
    toaster,
    discardPending,
    onDeleted,
    document.category.id,
    document.key,
  ]);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-start gap-[16px]">
        <div className="flex-1 flex flex-col gap-[6px] min-w-0">
          <div className="flex items-center gap-[8px] text-[12px] text-textItemBlur">
            <span>{t('brain_title', 'Agent Brain')}</span>
            <span>/</span>
            <span>
              {t(document.category.labelKey, document.category.label)}
            </span>
            <span>/</span>
            <span className="text-warm">{document.label}</span>
          </div>
          {canRename ? (
            <input
              value={title}
              maxLength={BRAIN_HEADING_MAX}
              onChange={(event) => {
                setTitle(event.target.value);
                save({ title: event.target.value });
              }}
              placeholder={t('brain_untitled', 'Untitled source')}
              className="text-[28px] font-[500] bg-transparent outline-none w-full placeholder:text-textItemBlur"
            />
          ) : (
            <h2 className="text-[28px] font-[500]">{document.label}</h2>
          )}
          {!!document.description && (
            <div className="text-[14px] text-textItemBlur">
              {document.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-[12px] pt-[4px]">
          <BrainSaveIndicator state={state} onRetry={retry} />
        </div>
      </div>

      {hasLinks && (
        <BrainLinks
          links={current.links || []}
          onChange={(links) => save({ links })}
        />
      )}

      {hasAssets && (
        <BrainAssets
          assets={current.assets || []}
          onChange={(assets) => save({ assets })}
        />
      )}

      {readOnly && (
        <div className="flex items-center gap-[8px] text-[12px] text-textItemBlur">
          <span className="w-[6px] h-[6px] rounded-full bg-warm" />
          {t('brain_agent_kept', 'Kept by the agent — shown here so you can see what it has learned')}
        </div>
      )}

      {readOnly && !blocks.length && (
        <div className="text-[14px] text-textItemBlur">
          {t('brain_agent_empty', 'Fills in as agent learns')}
        </div>
      )}

      {readOnly &&
        blocks.map((block) => (
          <div key={block.id} className="flex flex-col gap-[6px] mt-[10px]">
            <h3 className="text-[22px] font-[600]">{block.heading}</h3>
            <div className="text-[15px] leading-[1.7] whitespace-pre-wrap">
              {block.body}
            </div>
          </div>
        ))}

      {/* No cards, no rules: a heading and the text under it, straight on the
          page, the way a document reads. */}
      {!readOnly &&
        blocks.map((block) => (
        <div key={block.id} className="flex flex-col gap-[6px] mt-[10px]">
          <div className="flex items-start gap-[10px]">
            <input
              value={block.heading}
              maxLength={BRAIN_HEADING_MAX}
              onChange={(event) =>
                changeBlock(block.id, 'heading', event.target.value)
              }
              placeholder={t('brain_heading_placeholder', 'Heading')}
              className="flex-1 text-[22px] font-[600] bg-transparent outline-none placeholder:text-textItemBlur"
            />
            <div
              onClick={removeBlock(block.id)}
              data-tooltip-id="tooltip"
              data-tooltip-content={t('brain_remove_block', 'Remove')}
              className="shrink-0 mt-[4px] cursor-pointer select-none w-[28px] h-[28px] rounded-[6px] flex items-center justify-center text-textItemBlur hover:text-warm hover:bg-warmHover transition-colors"
            >
              <TrashIcon />
            </div>
          </div>
          <BrainTextarea
            value={block.body}
            placeholder={t('brain_body_placeholder', 'Write here...')}
            onChange={(value) => changeBlock(block.id, 'body', value)}
            className="w-full bg-transparent outline-none resize-none overflow-hidden text-[15px] leading-[1.7] placeholder:text-textItemBlur"
          />
        </div>
      ))}

      <div className="flex items-center gap-[10px] mt-[10px]">
        {blocks.length < BRAIN_BLOCKS_MAX && (
          <ActionButton
            icon="plus"
            label={t('brain_add_rule', 'Add a rule')}
            onClick={addBlock}
          />
        )}
        {canDelete && (
          <ActionButton
            icon="trash"
            label={t('brain_delete_document', 'Delete document')}
            onClick={remove}
          />
        )}
      </div>
    </div>
  );
};
