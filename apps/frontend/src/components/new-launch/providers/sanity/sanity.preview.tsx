'use client';

import { FC, useMemo } from 'react';
import useSWR from 'swr';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  SanityArticle,
  SanityBlock,
} from '@gitroom/frontend/components/new-launch/providers/sanity/sanity.article';

type SanityInspection = {
  ok: boolean;
  errors: string[];
  id: string;
  type: string;
  title: string;
  status: 'draft' | 'published';
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  excerpt: string;
  body: SanityBlock[];
  image: string;
  liveUrl: string;
  editUrl: string;
};

const useSanityDocument = (integrationId?: string, documentId?: string) => {
  const customFunc = useCustomProviderFunction();

  return useSWR<SanityInspection | false>(
    integrationId && documentId
      ? `sanity-inspect-${integrationId}-${documentId}`
      : null,
    () => customFunc.get('validateDocument', { documentId }),
    {
      revalidateOnFocus: false,
    }
  );
};

/**
 * The blog post as it stands in Sanity right now. Nothing here comes from our
 * database - the card is re-read from Sanity every time it is shown, so a
 * document that was edited, unpublished or deleted after being scheduled tells
 * the truth rather than a stale copy.
 */
export const SanityPreview: FC<{ maximumCharacters?: number }> = () => {
  const t = useT();
  const { integration, value } = useIntegration();
  const settings = useSettings();

  // The review feed hands the settings in through a form; the editor has the
  // live form. Either way the id is there, and the content marker is the
  // fallback for a post saved before the settings were attached.
  const documentId = useMemo(() => {
    const fromSettings = settings?.getValues?.()?.documentId;
    if (fromSettings) {
      return fromSettings as string;
    }

    const marker = (value?.[0]?.content || '').match(/sanity:([^\s<]+)/);
    return marker?.[1] || '';
  }, [settings, value]);

  // What the feed already knew about this document before asking Sanity for
  // the article itself. Enough to draw the card; the body arrives after.
  const seed = useMemo(
    () => settings?.getValues?.()?.sanitySeed as
      | { title?: string; image?: string; status?: 'draft' | 'published' }
      | undefined,
    [settings]
  );

  const { data, isLoading } = useSanityDocument(integration?.id, documentId);

  if (!documentId) {
    return (
      <div className="p-[16px] text-[14px] text-textColor/60">
        {t('sanity_no_document_selected', 'No Sanity document selected yet.')}
      </div>
    );
  }

  // A feed of blog cards fires one of these per card, so the wait is measured
  // in the whole queue rather than one request. Everything already in hand is
  // drawn straight away and only the article body waits.
  if (isLoading) {
    return (
      <div className="p-[16px] flex flex-col gap-[12px]">
        {!!seed?.image && (
          <img
            src={seed.image}
            alt=""
            className="w-full max-h-[260px] object-cover rounded-[10px]"
          />
        )}
        {!!seed?.title && (
          <div className="text-[20px] font-[700] leading-[1.3]">
            {seed.title}
          </div>
        )}
        <div className="text-[14px] text-textColor/60">
          {t('sanity_loading_document', 'Reading this post from Sanity…')}
        </div>
      </div>
    );
  }

  // `/integrations/function` answers `false` when the provider call throws, so
  // an unusable response is treated the same as a broken document: the point of
  // this card is that a problem is never silent.
  const inspection: SanityInspection =
    data && typeof data === 'object'
      ? data
      : {
          ok: false,
          errors: [
            t(
              'sanity_unreachable',
              'Could not read this post from Sanity. The channel token may have expired.'
            ),
          ],
          id: documentId,
          type: '',
          title: '',
          status: 'draft',
          hasUnpublishedChanges: false,
          updatedAt: '',
          excerpt: '',
          body: [],
          image: '',
          liveUrl: '',
          editUrl: '',
        };

  return (
    <div className="p-[16px] flex flex-col gap-[12px]">
      {!inspection.ok && (
        <div className="flex flex-col gap-[4px] rounded-[8px] border border-red-500 bg-red-500/10 p-[12px]">
          <div className="text-[14px] font-[600] text-red-500">
            {t('sanity_needs_fixing', 'This post needs fixing in Sanity')}
          </div>
          {inspection.errors.map((error) => (
            <div key={error} className="text-[13px] text-red-500">
              {error}
            </div>
          ))}
        </div>
      )}

      {!!(inspection.image || seed?.image) && (
        <img
          src={inspection.image || seed?.image}
          alt=""
          className="w-full max-h-[260px] object-cover rounded-[10px]"
        />
      )}

      <div className="text-[20px] font-[700] leading-[1.3]">
        {inspection.title || seed?.title || (
          <span className="text-red-500">
            {t('sanity_untitled', 'Untitled document')}
          </span>
        )}
      </div>

      {!!inspection.excerpt && (
        <div className="text-[14px] whitespace-pre-line text-textColor/80 italic">
          {inspection.excerpt}
        </div>
      )}

      {/* The article exactly as it will appear once published - images,
          callouts and lists included. Approving a post means seeing the post. */}
      <SanityArticle blocks={inspection.body} />
    </div>
  );
};
