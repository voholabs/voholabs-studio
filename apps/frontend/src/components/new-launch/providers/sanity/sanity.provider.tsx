'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { SanityDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/sanity.dto';
import { SanityPreview } from '@gitroom/frontend/components/new-launch/providers/sanity/sanity.preview';
import { useSanityDocuments } from '@gitroom/frontend/components/new-launch/providers/sanity/sanity.document.picker';

/**
 * Nothing to fill in. The article is written in Sanity, and which article this
 * post publishes was decided by pressing Schedule on it - so this panel only
 * confirms what was picked and offers the way out to Sanity.
 */
const SanitySettings: FC = () => {
  const form = useSettings();
  const t = useT();
  const { integration } = useIntegration();
  const { documents } = useSanityDocuments(integration?.id);

  const documentId = form?.getValues?.()?.documentId;
  const selected = documents?.find((doc) => doc.id === documentId);

  // Keeps the id in the submitted settings without putting a control on screen.
  form?.register?.('documentId');

  if (!documentId) {
    return (
      <div className="flex flex-col gap-[8px] text-[13px] text-textColor/70">
        <div>
          {t(
            'sanity_pick_from_list',
            'Blog posts are written in Sanity. Find the post in your list and press Schedule on it - there is nothing to fill in here.'
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="text-[13px] text-textColor/70">
        {t(
          'sanity_will_publish',
          'This will publish the following post in Sanity at the time you choose.'
        )}
      </div>

      <div className="flex gap-[10px] items-center p-[10px] rounded-[8px] bg-newTableHeader">
        {!!selected?.image && (
          <img
            src={selected.image}
            alt=""
            className="w-[48px] h-[48px] rounded-[6px] object-cover"
          />
        )}
        <div className="flex flex-col gap-[2px] min-w-0">
          <div className="text-[14px] font-[600] truncate">
            {selected?.title || documentId}
          </div>
          <div className="text-[12px] text-textColor/60">
            {selected?.status === 'published'
              ? t('published', 'Published')
              : t('draft', 'Draft')}
          </div>
        </div>
      </div>

      {!!selected?.editUrl && (
        <a
          href={selected.editUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[13px] underline text-forth w-fit"
        >
          {t('edit_in_sanity', 'Edit in Sanity')}
        </a>
      )}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  comments: false,
  SettingsComponent: SanitySettings,
  CustomPreviewComponent: SanityPreview,
  dto: SanityDto,
  maximumCharacters: 100000,
});
