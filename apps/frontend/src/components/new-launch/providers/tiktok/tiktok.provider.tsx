'use client';

import {
  FC,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';
import useSWR from 'swr';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { TikTokDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Select } from '@gitroom/react/form/select';
import { Checkbox } from '@gitroom/react/form/checkbox';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { Input } from '@gitroom/react/form/input';
import { TiktokPreview } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.preview';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';

type CreatorInfo = {
  canPost: boolean;
  errorCode: string | null;
  nickname: string;
  username: string;
  avatar: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
};

// TikTok requires the latest creator info every time the post page renders.
const useCreatorInfo = () => {
  const { integration } = useIntegration();
  const customFunc = useCustomProviderFunction();
  return useSWR<CreatorInfo>(
    integration?.id ? `tiktok-creator-info-${integration.id}` : null,
    () => customFunc.get('creatorInfo'),
    { revalidateOnMount: true, dedupingInterval: 0 }
  );
};

// Length of the video about to be posted, read from its metadata.
const useVideoDuration = (path?: string) => {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    setDuration(null);
    if (!path) {
      return;
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => setDuration(video.duration);
    video.src = path;
    return () => {
      video.onloadedmetadata = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [path]);
  return duration;
};

// The shared Checkbox has no disabled state, so a switched-off interaction is
// greyed out and made unclickable here, with the reason on hover.
const Locked: FC<{ locked: boolean; reason?: string; children: ReactNode }> = ({
  locked,
  reason,
  children,
}) => (
  <div
    title={locked ? reason : undefined}
    className={clsx(locked && 'opacity-50 cursor-not-allowed')}
  >
    <div className={clsx(locked && 'pointer-events-none')}>{children}</div>
  </div>
);

const TikTokSettings: FC<{
  values?: any;
}> = (props) => {
  const { watch, register, setValue } = useSettings();
  const { value } = useIntegration();
  const t = useT();
  const { data: creatorInfo, isLoading: creatorInfoLoading } =
    useCreatorInfo();

  const isTitle = useMemo(() => {
    return value?.[0]?.image?.some((p) => (p?.path?.indexOf?.('mp4') ?? -1) === -1);
  }, [value]);

  const hasMedia = (value?.[0]?.image?.length ?? 0) > 0;
  const isVideo = hasMedia && !isTitle;

  const disclose = watch('disclose');
  const brand_organic_toggle = watch('brand_organic_toggle');
  const brand_content_toggle = watch('brand_content_toggle');
  const content_posting_method = watch('content_posting_method');
  const isUploadMode = content_posting_method === 'UPLOAD';
  const privacy_level = watch('privacy_level');

  const videoPath = isVideo
    ? value?.[0]?.image?.find((p) => (p?.path?.indexOf?.('mp4') ?? -1) > -1)
        ?.path
    : undefined;
  const videoDuration = useVideoDuration(videoPath);

  // TikTok: stop the post when the account can't post right now, or when the
  // video is longer than this account allows.
  const creatorBlock = useMemo(() => {
    if (!creatorInfo) {
      return '';
    }
    if (!creatorInfo.canPost) {
      return t(
        'tiktok_cannot_post_now',
        'This TikTok account cannot make more posts right now. Please try again later.'
      );
    }
    if (
      videoDuration &&
      creatorInfo.maxVideoPostDurationSec &&
      videoDuration > creatorInfo.maxVideoPostDurationSec
    ) {
      return t(
        'tiktok_video_too_long',
        `This video is longer than this TikTok account allows (${creatorInfo.maxVideoPostDurationSec} seconds). Please use a shorter video.`
      );
    }
    return '';
  }, [creatorInfo, videoDuration, t]);

  useEffect(() => {
    setValue('creator_check', creatorBlock || undefined, {
      shouldValidate: true,
    });
  }, [creatorBlock]);

  const tiktokRestrictionNotice = useMemo(() => {
    if (!hasMedia || !isVideo) return null;
    if (!isUploadMode) {
      return t(
        'tiktok_restriction_direct_video',
        'TikTok restriction: For direct post with video, your post content is used as the title. A separate title field is not available.'
      );
    }
    return t(
      'tiktok_restriction_upload_video',
      'TikTok restriction: For upload-only video, TikTok does not accept a title or message. You can add them inside the TikTok app before publishing.'
    );
  }, [hasMedia, isUploadMode, isVideo, t]);

  const privacyLabels: Record<string, string> = {
    PUBLIC_TO_EVERYONE: t('public_to_everyone', 'Public to everyone'),
    MUTUAL_FOLLOW_FRIENDS: t('mutual_follow_friends', 'Mutual follow friends'),
    FOLLOWER_OF_CREATOR: t('follower_of_creator', 'Follower of creator'),
    SELF_ONLY: t('self_only', 'Self only'),
  };
  // Only the options TikTok returns for this account, in its order
  const privacyLevel = (creatorInfo?.privacyLevelOptions || [])
    .filter((option) => privacyLabels[option])
    .map((option) => ({ value: option, label: privacyLabels[option] }));
  const contentPostingMethod = [
    {
      value: 'DIRECT_POST',
      label: t(
        'post_content_directly_to_tiktok',
        'Post content directly to TikTok'
      ),
    },
    {
      value: 'UPLOAD',
      label: t(
        'upload_content_to_tiktok_without_posting',
        'Upload content to TikTok without posting it'
      ),
    },
  ];
  const yesNo = [
    {
      value: 'yes',
      label: t('yes', 'Yes'),
    },
    {
      value: 'no',
      label: t('no', 'No'),
    },
  ];

  return (
    <div className="flex flex-col">
      {/*<CheckTikTokValidity picture={props?.values?.[0]?.image?.[0]?.path} />*/}
      {tiktokRestrictionNotice && (
        <div className="bg-tableBorder p-[10px] mb-[18px] rounded-[10px] flex gap-[10px] items-start text-[13px] text-balance">
          <div className="shrink-0 mt-[2px]">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M22.201 17.6335L14.0026 3.39569C13.7977 3.04687 13.5052 2.75764 13.1541 2.55668C12.803 2.35572 12.4055 2.25 12.001 2.25C11.5965 2.25 11.199 2.35572 10.8479 2.55668C10.4968 2.75764 10.2043 3.04687 9.99944 3.39569L1.80101 17.6335C1.60388 17.9709 1.5 18.3546 1.5 18.7454C1.5 19.1361 1.60388 19.5199 1.80101 19.8572C2.00325 20.2082 2.29523 20.499 2.64697 20.6998C2.99871 20.9006 3.39755 21.0043 3.80257 21.0001H20.1994C20.6041 21.0039 21.0026 20.9001 21.354 20.6993C21.7054 20.4985 21.997 20.2079 22.1991 19.8572C22.3965 19.52 22.5007 19.1364 22.5011 18.7456C22.5014 18.3549 22.3978 17.9711 22.201 17.6335ZM11.251 9.75006C11.251 9.55115 11.33 9.36038 11.4707 9.21973C11.6113 9.07908 11.8021 9.00006 12.001 9.00006C12.1999 9.00006 12.3907 9.07908 12.5313 9.21973C12.672 9.36038 12.751 9.55115 12.751 9.75006V13.5001C12.751 13.699 12.672 13.8897 12.5313 14.0304C12.3907 14.171 12.1999 14.2501 12.001 14.2501C11.8021 14.2501 11.6113 14.171 11.4707 14.0304C11.33 13.8897 11.251 13.699 11.251 13.5001V9.75006ZM12.001 18.0001C11.7785 18.0001 11.561 17.9341 11.376 17.8105C11.191 17.6868 11.0468 17.5111 10.9616 17.3056C10.8765 17.1 10.8542 16.8738 10.8976 16.6556C10.941 16.4374 11.0482 16.2369 11.2055 16.0796C11.3628 15.9222 11.5633 15.8151 11.7815 15.7717C11.9998 15.7283 12.226 15.7505 12.4315 15.8357C12.6371 15.9208 12.8128 16.065 12.9364 16.25C13.06 16.4351 13.126 16.6526 13.126 16.8751C13.126 17.1734 13.0075 17.4596 12.7965 17.6706C12.5855 17.8815 12.2994 18.0001 12.001 18.0001Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>{tiktokRestrictionNotice}</div>
        </div>
      )}
      <div className="flex items-center gap-[10px] mb-[18px] text-[14px]">
        {creatorInfo?.avatar ? (
          <img
            src={creatorInfo.avatar}
            alt=""
            className="w-[32px] h-[32px] rounded-full"
          />
        ) : null}
        <div>
          {creatorInfoLoading && !creatorInfo
            ? t('tiktok_loading_account', 'Loading TikTok account...')
            : creatorInfo?.nickname
            ? `${t('tiktok_posting_to', 'Posting to TikTok as')} ${
                creatorInfo.nickname
              }`
            : t(
                'tiktok_account_unavailable',
                'Could not load this TikTok account. Please reconnect the channel.'
              )}
        </div>
      </div>
      {!!creatorBlock && (
        <div className="mb-[18px] text-[14px] text-red-600">{creatorBlock}</div>
      )}
      {isTitle && <Input label="Title" {...register('title')} maxLength={89} />}
      <Select
        label={t('label_who_can_see_this_video', 'Who can see this video?')}
        disabled={isUploadMode}
        {...register('privacy_level')}
      >
        <option value="">{t('select', 'Select')}</option>
        {privacyLevel.map((item) => (
          <option
            key={item.value}
            value={item.value}
            disabled={item.value === 'SELF_ONLY' && !!brand_content_toggle}
            title={
              item.value === 'SELF_ONLY' && brand_content_toggle
                ? t(
                    'branded_content_cannot_be_private',
                    'Branded content visibility cannot be set to private.'
                  )
                : undefined
            }
          >
            {item.label}
          </option>
        ))}
      </Select>
      <div className="text-[14px] mt-[10px] mb-[18px] text-balance">
        {t(
          'choose_upload_without_posting_description',
          `Choose upload without posting if you want to review and edit your content within TikTok's app before publishing.
        This gives you access to TikTok's built-in editing tools and lets you make final adjustments before posting.`
        )}
      </div>
      <Select
        label={t('label_content_posting_method', 'Content posting method')}
        {...register('content_posting_method', {
          value: 'DIRECT_POST',
        })}
      >
        <option value="">{t('select', 'Select')}</option>
        {contentPostingMethod.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      {isUploadMode && <div className="-mt-[23px] mb-[23px] text-red-600">After posting you will find a notification inside your Inbox about your post (not content studio)</div>}
      <Select
        label={t('label_auto_add_music', 'Auto add music')}
        {...register('autoAddMusic', {
          value: 'no',
        })}
      >
        <option value="">{t('select', 'Select')}</option>
        {yesNo.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      <div className="text-[14px] mt-[10px] mb-[24px] text-balance">
        {t(
          'this_feature_available_only_for_photos',
          'This feature available only for photos, it will add a default music that\n        you can change later.'
        )}
      </div>
      <hr className="mb-[15px] border-tableBorder" />
      <div className="text-[14px] mb-[10px]">
        {t('allow_user_to', 'Allow User To:')}
      </div>
      <div className="flex gap-[40px]">
        <Locked
          locked={isUploadMode || !!creatorInfo?.commentDisabled}
          reason={t(
            'tiktok_interaction_off',
            'This interaction is turned off in the TikTok app settings for this account.'
          )}
        >
          <Checkbox
            label={t('label_comments', 'Comments')}
            variant="hollow"
            {...register('comment', {
              value: false,
            })}
          />
        </Locked>
        {/* Duet and Stitch don't apply to photo posts */}
        <div className={clsx('flex gap-[40px]', isTitle && 'hidden')}>
          <Locked
            locked={isUploadMode || !!creatorInfo?.duetDisabled}
            reason={t(
              'tiktok_interaction_off',
              'This interaction is turned off in the TikTok app settings for this account.'
            )}
          >
            <Checkbox
              variant="hollow"
              label={t('label_duet', 'Duet')}
              {...register('duet', {
                value: false,
              })}
            />
          </Locked>
          <Locked
            locked={isUploadMode || !!creatorInfo?.stitchDisabled}
            reason={t(
              'tiktok_interaction_off',
              'This interaction is turned off in the TikTok app settings for this account.'
            )}
          >
            <Checkbox
              label={t('label_stitch', 'Stitch')}
              variant="hollow"
              {...register('stitch', {
                value: false,
              })}
            />
          </Locked>
        </div>
      </div>
      <hr className="my-[15px] mb-[25px] border-tableBorder" />
      <div className="flex flex-col gap-[20px]">
        <Checkbox
          label={t('video_made_with_ai', 'Video made with AI')}
          variant="hollow"
          {...register('video_made_with_ai', {
            value: false,
          })}
        />
        <Locked locked={isUploadMode}>
          <Checkbox
            variant="hollow"
            label={t('tiktok_content_disclosure_setting', 'Content disclosure setting')}
            {...register('disclose', {
              value: false,
            })}
          />
        </Locked>
        {disclose && (
          <div className="bg-tableBorder p-[10px] mt-[10px] rounded-[10px] flex gap-[20px] items-center">
            <div>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M22.201 17.6335L14.0026 3.39569C13.7977 3.04687 13.5052 2.75764 13.1541 2.55668C12.803 2.35572 12.4055 2.25 12.001 2.25C11.5965 2.25 11.199 2.35572 10.8479 2.55668C10.4968 2.75764 10.2043 3.04687 9.99944 3.39569L1.80101 17.6335C1.60388 17.9709 1.5 18.3546 1.5 18.7454C1.5 19.1361 1.60388 19.5199 1.80101 19.8572C2.00325 20.2082 2.29523 20.499 2.64697 20.6998C2.99871 20.9006 3.39755 21.0043 3.80257 21.0001H20.1994C20.6041 21.0039 21.0026 20.9001 21.354 20.6993C21.7054 20.4985 21.997 20.2079 22.1991 19.8572C22.3965 19.52 22.5007 19.1364 22.5011 18.7456C22.5014 18.3549 22.3978 17.9711 22.201 17.6335ZM11.251 9.75006C11.251 9.55115 11.33 9.36038 11.4707 9.21973C11.6113 9.07908 11.8021 9.00006 12.001 9.00006C12.1999 9.00006 12.3907 9.07908 12.5313 9.21973C12.672 9.36038 12.751 9.55115 12.751 9.75006V13.5001C12.751 13.699 12.672 13.8897 12.5313 14.0304C12.3907 14.171 12.1999 14.2501 12.001 14.2501C11.8021 14.2501 11.6113 14.171 11.4707 14.0304C11.33 13.8897 11.251 13.699 11.251 13.5001V9.75006ZM12.001 18.0001C11.7785 18.0001 11.561 17.9341 11.376 17.8105C11.191 17.6868 11.0468 17.5111 10.9616 17.3056C10.8765 17.1 10.8542 16.8738 10.8976 16.6556C10.941 16.4374 11.0482 16.2369 11.2055 16.0796C11.3628 15.9222 11.5633 15.8151 11.7815 15.7717C11.9998 15.7283 12.226 15.7505 12.4315 15.8357C12.6371 15.9208 12.8128 16.065 12.9364 16.25C13.06 16.4351 13.126 16.6526 13.126 16.8751C13.126 17.1734 13.0075 17.4596 12.7965 17.6706C12.5855 17.8815 12.2994 18.0001 12.001 18.0001Z"
                  fill="white"
                />
              </svg>
            </div>
            <div>
              {brand_content_toggle
                ? t(
                    'your_content_will_be_labeled_paid_partnership',
                    "Your photo/video will be labeled as 'Paid partnership'"
                  )
                : brand_organic_toggle
                ? t(
                    'tiktok_labeled_promotional_content',
                    "Your photo/video will be labeled as 'Promotional content'"
                  )
                : t(
                    'tiktok_disclosure_choose',
                    'You need to indicate if your content promotes yourself, a third party, or both.'
                  )}
              <br />
              {t(
                'this_cannot_be_changed_once_posted',
                'This cannot be changed once your video is posted.'
              )}
            </div>
          </div>
        )}
        <div className="text-[14px] my-[10px] text-balance">
          {t(
            'tiktok_disclosure_description',
            'Indicate whether this content promotes yourself, a brand, product or service.'
          )}
        </div>
      </div>
      <div className={clsx(!disclose && 'invisible h-0 overflow-hidden', 'mt-[20px]')}>
        <Locked locked={isUploadMode}>
          <Checkbox
            variant="hollow"
            label={t('label_your_brand', 'Your brand')}
            {...register('brand_organic_toggle', {
              value: false,
            })}
          />
        </Locked>
        <div className="text-balance my-[10px] text-[14px]">
          {t(
            'you_are_promoting_yourself',
            'You are promoting yourself or your own brand.'
          )}
          <br />
          {t(
            'this_video_will_be_classified_brand_organic',
            'This video will be classified as Brand Organic.'
          )}
        </div>
        <Locked
          locked={isUploadMode || privacy_level === 'SELF_ONLY'}
          reason={t(
            'visibility_branded_content_cannot_be_private',
            "Visibility for branded content can't be private."
          )}
        >
          <Checkbox
            variant="hollow"
            label={t('label_branded_content', 'Branded content')}
            {...register('brand_content_toggle', {
              value: false,
            })}
          />
        </Locked>
        {privacy_level === 'SELF_ONLY' && (
          <div className="text-[14px] -mt-[5px] mb-[10px] opacity-80">
            {t(
              'visibility_branded_content_cannot_be_private',
              "Visibility for branded content can't be private."
            )}
          </div>
        )}
        <div className="text-balance my-[10px] text-[14px]">
          {t(
            'you_are_promoting_another_brand',
            'You are promoting another brand or a third party.'
          )}
          <br />
          {t(
            'this_video_will_be_classified_branded_content',
            'This video will be classified as Branded Content.'
          )}
        </div>
      </div>
      {!isUploadMode && (
        <div className="mt-[20px] text-[14px] text-balance">
          {t('by_posting_you_agree_to_tiktoks', "By posting, you agree to TikTok's")}{' '}
          {brand_content_toggle ? (
            <>
              <a
                target="_blank"
                rel="noreferrer"
                className="text-[#B8DDE1] hover:underline"
                href="https://www.tiktok.com/legal/page/global/bc-policy/en"
              >
                {t('branded_content_policy', 'Branded Content Policy')}
              </a>{' '}
              {t('and', 'and')}{' '}
            </>
          ) : null}
          <a
            target="_blank"
            rel="noreferrer"
            className="text-[#B8DDE1] hover:underline"
            href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
          >
            {t('music_usage_confirmation', 'Music Usage Confirmation')}
          </a>
          .
          <div className="mt-[10px] opacity-80">
            {t(
              'tiktok_processing_notice',
              'After your post is published, it may take a few minutes for it to process and be visible on your TikTok profile.'
            )}
          </div>
        </div>
      )}
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: TikTokSettings,
  comments: false,
  CustomPreviewComponent: TiktokPreview,
  dto: TikTokDto,
  maximumCharacters: 2000,
});
