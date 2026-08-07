'use client';

import { useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { isDocumentEmpty } from '@gitroom/nestjs-libraries/agent-brain/brain.registry';
import {
  useBrainTree,
  BrainTreeDocument,
  BrainTreeGroup,
} from '@gitroom/frontend/components/agent-brain/use.brain.tree';
import {
  BRAIN_DOCUMENTS_KEY,
  BrainDocumentsResponse,
  useBrainDocuments,
} from '@gitroom/frontend/components/agent-brain/use.brain.documents';
import { BrainTree } from '@gitroom/frontend/components/agent-brain/brain.tree';
import { BrainDocument } from '@gitroom/frontend/components/agent-brain/brain.document';

// /brain, /brain/<category>, /brain/<category>/<document key>
export const AgentBrain = () => {
  const t = useT();
  const router = useRouter();
  const params = useParams();
  const fetch = useFetch();
  const toaster = useToaster();
  const { mutate } = useSWRConfig();
  const { data, isLoading: documentsLoading } = useBrainDocuments();
  const { groups, findDocument, firstDocument, isLoading } = useBrainTree(
    data?.documents
  );

  const slug = (params?.slug as string[]) || [];
  const [categoryId, documentKey] = slug;

  const active = useMemo(
    () => findDocument(categoryId, documentKey) || firstDocument,
    [findDocument, categoryId, documentKey, firstDocument]
  );

  const content = useMemo(
    () =>
      data?.documents.find(
        (document) =>
          document.category === active?.category.id &&
          document.key === active?.key
      )?.content,
    [data, active]
  );

  const isFilled = useCallback(
    (document: BrainTreeDocument) =>
      !isDocumentEmpty(
        data?.documents.find(
          (one) =>
            one.category === document.category.id && one.key === document.key
        )?.content
      ),
    [data]
  );

  const select = useCallback(
    (document: BrainTreeDocument) =>
      router.push(
        `/brain/${document.category.id}/${encodeURIComponent(document.key)}`
      ),
    [router]
  );

  // A user-created document only exists once it is saved, so creating one is a
  // save of an empty document under a fresh key.
  const create = useCallback(
    async (group: BrainTreeGroup) => {
      const key = makeId(12);
      const response = await fetch(
        `/brain/${encodeURIComponent(group.category.id)}/${key}`,
        { method: 'PATCH', body: JSON.stringify({ title: '', blocks: [] }) }
      );

      if (!response.ok) {
        toaster.show(t('brain_save_failed', 'Could not save'), 'warning');
        return;
      }

      const saved = await response.json();
      mutate<BrainDocumentsResponse>(
        BRAIN_DOCUMENTS_KEY,
        (current) =>
          current && { ...current, documents: [...current.documents, saved] },
        { revalidate: false }
      );

      router.push(`/brain/${group.category.id}/${key}`);
    },
    [fetch, mutate, router, t, toaster]
  );

  const afterDelete = useCallback(() => router.push('/brain'), [router]);

  return (
    <>
      <div className="bg-newBgColorInner w-[300px] relative">
        <div className="absolute top-0 start-0 w-full h-full p-[20px] overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
          <BrainTree
            groups={groups}
            active={active}
            isFilled={isFilled}
            onSelect={select}
            onCreate={create}
          />
        </div>
      </div>
      <div className="bg-newBgColorInner flex-1 relative">
        <div className="absolute top-0 start-0 w-full h-full p-[20px] overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
          {isLoading || documentsLoading ? (
            <LoadingComponent />
          ) : active ? (
            <BrainDocument
              key={`${active.category.id}:${active.key}`}
              document={active}
              content={content}
              onDeleted={afterDelete}
            />
          ) : (
            <div className="text-textItemBlur">
              {t('brain_empty_state', 'Pick a document to start')}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
