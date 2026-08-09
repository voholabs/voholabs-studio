'use client';

import React, {
  Component,
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { FormProvider, useForm } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { IntegrationContext } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { GeneralPreviewComponent } from '@gitroom/frontend/components/launches/general.preview.component';
import { Providers } from '@gitroom/frontend/components/new-launch/providers/show.all.providers';
import { getProviderSettingsMeta } from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import { CreationMethodBadge } from '@gitroom/frontend/components/launches/creation.method.badge';
import { ReviewedCheckIcon } from '@gitroom/frontend/components/launches/reviewed.checkbox';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

/**
 * Past this the card collapses and offers to expand. A page of the feed is 25
 * posts — without a ceiling a couple of long ones bury everything after them.
 */
const COLLAPSED_PREVIEW_HEIGHT = 560;

/**
 * TikTok, YouTube and Pinterest previews were written to own the editor's whole
 * preview pane: they position themselves absolutely and stretch to `h-full`.
 * Dropped into a review card they escape it and paint over the rest of the feed.
 *
 * YouTube and Pinterest are stacks of content-sized rows, so pulling them back
 * into normal flow is enough. TikTok derives its 9:16 frame from the height of
 * the pane, so it keeps the absolute layout and gets a pane of its own to fill.
 *
 * These are static strings on purpose — Tailwind only emits classes it can find
 * in the source.
 */
const paneClassName = (identifier?: string) => {
  switch (identifier) {
    case 'tiktok':
      return 'relative h-[560px]';
    case 'youtube':
    case 'pinterest':
      return '[&>div]:!static [&>div]:!h-auto';
    default:
      return '';
  }
};

/**
 * A review card only pulls the full post once it is near the viewport — a page
 * of the feed is 25 posts and each one costs its own request.
 */
const useNearViewport = (ref: React.RefObject<HTMLElement>) => {
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near || !ref.current) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
        }
      },
      {
        rootMargin: '600px 0px',
      }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near]);

  return near;
};

const usePostGroup = (group: string, enabled: boolean) => {
  const fetch = useFetch();

  return useSWR(
    enabled ? `/posts/group/${group}` : null,
    async (url: string) => (await fetch(url)).json(),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
    }
  );
};

/**
 * Previews grow as their images decode, so the collapse decision has to be
 * re-taken rather than measured once on mount.
 */
const useMeasuredHeight = (ref: React.RefObject<HTMLElement>, deps: any) => {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    setHeight(element.scrollHeight);

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => setHeight(element.scrollHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [deps]);

  return height;
};

/**
 * The per-platform previews were written for the editor only. If one of them
 * trips over a post shape it has never seen, degrade to the generic preview
 * instead of taking the whole feed down.
 */
class PreviewErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const PreviewBody: FC<{
  integration: Integrations;
  data: any;
}> = ({ integration, data }) => {
  const meta = useMemo(
    () =>
      getProviderSettingsMeta(
        Providers.find((p) => p.identifier === integration.identifier)
          ?.component
      ),
    [integration.identifier]
  );

  // Facebook's preview reads its text format preset off the form, so the
  // provider settings have to be in scope exactly like they are in the editor.
  const form = useForm({
    defaultValues: data?.settings || {},
  });

  const value = useMemo(
    () =>
      (data?.posts || []).map((p: any) => ({
        id: p.id,
        content: p.content,
        image: p.image || [],
      })),
    [data]
  );

  const maximumCharacters = useMemo(() => {
    const max = meta?.maximumCharacters;
    if (typeof max === 'number') {
      return max;
    }
    if (typeof max === 'function') {
      return max(JSON.parse(integration.additionalSettings || '[]'));
    }
    return 10000;
  }, [meta, integration.additionalSettings]);

  const CustomPreview = meta?.CustomPreviewComponent;

  return (
    <IntegrationContext.Provider
      value={{
        date: newDayjs(),
        integration,
        allIntegrations: [integration],
        value,
        previewOnly: true,
      }}
    >
      <FormProvider {...form}>
        <div className={paneClassName(integration.identifier)}>
          {CustomPreview ? (
            <PreviewErrorBoundary
              fallback={
                <GeneralPreviewComponent
                  maximumCharacters={maximumCharacters}
                />
              }
            >
              <CustomPreview maximumCharacters={maximumCharacters} />
            </PreviewErrorBoundary>
          ) : (
            <GeneralPreviewComponent maximumCharacters={maximumCharacters} />
          )}
        </div>
      </FormProvider>
    </IntegrationContext.Provider>
  );
};

export const ReviewPostCard: FC<{
  post: any;
  integrations: Integrations[];
  isNext?: boolean;
  editPost: () => void;
  deletePost: () => void;
  onReviewed?: () => void;
}> = ({ post, integrations, isNext, editPost, deletePost, onReviewed }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const { data, isLoading } = usePostGroup(post.group, near);

  // Ticked optimistically — the feed only catches up on its next revalidation
  // and waiting for that makes the checkbox feel broken.
  const [reviewed, setReviewed] = useState(!!post.reviewed);

  useEffect(() => {
    setReviewed(!!post.reviewed);
  }, [post.reviewed]);

  const toggleReviewed = useCallback(
    async (next: boolean) => {
      setReviewed(next);

      try {
        // custom.fetch resolves on 4xx/5xx instead of rejecting, so the status
        // has to be checked before treating the toggle as saved.
        const response = await fetch(`/posts/${post.id}/reviewed`, {
          method: 'PUT',
          body: JSON.stringify({ reviewed: next }),
        });

        if (!response?.ok) {
          throw new Error(String(response?.status));
        }

        onReviewed?.();
      } catch (err) {
        setReviewed(!next);
        toaster.show(
          t('could_not_save_reviewed', 'Could not save the review mark'),
          'warning'
        );
      }
    },
    [fetch, post.id, onReviewed, toaster, t]
  );

  const [expanded, setExpanded] = useState(false);
  const contentHeight = useMeasuredHeight(bodyRef, data);
  const collapsed = !expanded && contentHeight > COLLAPSED_PREVIEW_HEIGHT;

  // The list payload is minified and carries no handle or provider settings —
  // the full channel does, and it is already in the calendar context.
  const integration = useMemo(() => {
    const found = integrations.find((i) => i.id === post.integration?.id);
    if (found) {
      return found;
    }

    return {
      id: post.integration?.id,
      name: post.integration?.name,
      identifier: post.integration?.providerIdentifier,
      picture: post.integration?.picture,
      display: '',
      type: 'social',
      editor: 'normal',
      disabled: false,
      inBetweenSteps: false,
      additionalSettings: '[]',
      changeProfilePicture: false,
      changeNickName: false,
      time: [],
    } as Integrations;
  }, [integrations, post.integration]);

  const preview = useCallback(() => {
    window.open(`/p/${post.id}?share=true`, '_blank');
  }, [post.id]);

  const publishDate = newDayjs(post.publishDate).local();
  const time = publishDate.format(isUSCitizen() ? 'hh:mm A' : 'HH:mm');
  const fromNow = publishDate.fromNow();

  // A group with children is a thread — worth calling out, because the preview
  // below stacks every part of it.
  const threadLength = data?.posts?.length || 0;

  return (
    <div
      ref={ref}
      className={clsx(
        'w-full flex flex-col bg-newColColor border rounded-[12px] transition-colors',
        post.state === 'ERROR'
          ? 'border-red-500'
          : reviewed
          ? 'border-forth'
          : isNext
          ? 'border-forth/40'
          : 'border-newTableBorder'
      )}
    >
      <div className="flex items-center gap-[10px] px-[14px] py-[12px] border-b border-newTableBorder">
        <div className="relative min-w-[36px]">
          <img
            className="w-[36px] h-[36px] rounded-full object-cover"
            src={integration.picture || '/no-picture.jpg'}
            alt={integration.name}
          />
          <img
            className="w-[16px] h-[16px] rounded-full absolute -bottom-[2px] -end-[2px] border border-fifth"
            src={`/icons/platforms/${integration.identifier}.png`}
            alt={integration.identifier}
          />
        </div>

        <div className="flex flex-col min-w-0 gap-[2px]">
          <div className="text-[14px] font-[600] truncate">
            {integration.name}
          </div>
          <div className="text-[12px] text-textColor/60 whitespace-nowrap">
            {time} <span className="opacity-40">•</span> {fromNow}
          </div>
        </div>

        <div className="flex items-center gap-[6px] flex-1 min-w-0 flex-wrap">
          {isNext && (
            <Badge className="bg-forth text-white">
              {t('next_up', 'Next up')}
            </Badge>
          )}
          {post.state === 'DRAFT' && (
            <Badge className="bg-newTableBorder">{t('draft', 'Draft')}</Badge>
          )}
          {post.state === 'ERROR' && (
            <Badge
              className="bg-red-500 text-white"
              tooltip={
                post.error ||
                t(
                  'an_error_occurred_publishing',
                  'An error occurred while publishing this post'
                )
              }
            >
              {t('error', 'Error')}
            </Badge>
          )}
          {threadLength > 1 && (
            <Badge className="bg-newTableBorder">
              {threadLength} {t('parts', 'parts')}
            </Badge>
          )}
          {post.tags?.map((p: any) => (
            <Badge
              key={p.tag.id}
              className="text-white"
              style={{ backgroundColor: p.tag.color }}
            >
              {p.tag.name}
            </Badge>
          ))}
          <CreationMethodBadge creationMethod={post.creationMethod} size="md" />
        </div>

        <div className="flex items-center gap-[6px] text-textColor">
          <ReviewAction
            onClick={() => toggleReviewed(!reviewed)}
            active={reviewed}
            label={
              reviewed
                ? t('reviewed_click_to_undo', 'Reviewed — click to undo')
                : t('mark_as_reviewed', 'Mark as reviewed')
            }
          >
            <ReviewedCheckIcon size={16} />
          </ReviewAction>
          <ReviewAction
            onClick={preview}
            label={t('preview_post', 'Preview Post')}
          >
            <PreviewIcon />
          </ReviewAction>
          <ReviewAction onClick={editPost} label={t('edit_post', 'Edit Post')}>
            <EditIcon />
          </ReviewAction>
          <ReviewAction
            onClick={deletePost}
            label={t('delete_post', 'Delete Post')}
            danger={true}
          >
            <DeleteIcon />
          </ReviewAction>
        </div>
      </div>

      <div
        className="relative p-[12px] overflow-hidden"
        style={
          collapsed
            ? { maxHeight: COLLAPSED_PREVIEW_HEIGHT + 24 }
            : undefined
        }
      >
        <div ref={bodyRef}>
          {!near || isLoading ? (
            <div className="text-[13px] text-textColor/50 px-[5px] py-[15px] line-clamp-2">
              {stripHtmlValidation('none', post.content, false, true, false) ||
                t('loading', 'Loading...')}
            </div>
          ) : !data?.posts?.length ? (
            <div className="text-[13px] text-textColor/50 px-[5px] py-[15px]">
              {t('could_not_load_preview', 'Could not load the preview')}
            </div>
          ) : (
            <PreviewBody integration={integration} data={data} />
          )}
        </div>

        {collapsed && (
          <div
            onClick={() => setExpanded(true)}
            className="absolute start-0 bottom-0 w-full pt-[60px] pb-[10px] flex justify-center cursor-pointer bg-gradient-to-b from-transparent to-newColColor"
          >
            <div className="text-[12px] font-[500] px-[12px] py-[5px] rounded-[6px] bg-newTableBorder hover:bg-boxFocused hover:text-textItemFocused transition-all">
              {t('show_full_post', 'Show full post')}
            </div>
          </div>
        )}
      </div>

      {expanded && contentHeight > COLLAPSED_PREVIEW_HEIGHT && (
        <div
          onClick={() => setExpanded(false)}
          className="text-[12px] text-textColor/60 hover:text-textColor text-center pb-[12px] cursor-pointer"
        >
          {t('collapse', 'Collapse')}
        </div>
      )}
    </div>
  );
};

const Badge: FC<{
  className?: string;
  style?: React.CSSProperties;
  tooltip?: string;
  children: ReactNode;
}> = ({ className, style, tooltip, children }) => (
  <div
    style={style}
    data-tooltip-id={tooltip ? 'tooltip' : undefined}
    data-tooltip-content={tooltip}
    className={clsx(
      'text-[11px] leading-[16px] px-[7px] py-[2px] rounded-[4px] whitespace-nowrap',
      className
    )}
  >
    {children}
  </div>
);

const ReviewAction: FC<{
  onClick: () => void;
  label: string;
  danger?: boolean;
  active?: boolean;
  children: ReactNode;
}> = ({ onClick, label, danger, active, children }) => (
  <div
    onClick={onClick}
    data-tooltip-id="tooltip"
    data-tooltip-content={label}
    className={clsx(
      'w-[32px] h-[32px] flex items-center justify-center rounded-[8px] border cursor-pointer transition-all',
      active
        ? 'bg-forth border-forth text-white'
        : 'border-newTableBorder',
      !active &&
        (danger
          ? 'hover:bg-red-500 hover:border-red-500 hover:text-white'
          : 'hover:text-textItemFocused hover:bg-boxFocused')
    )}
  >
    {children}
  </div>
);

const PreviewIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 32 32"
    fill="none"
  >
    <path
      d="M30.9137 15.595C30.87 15.4963 29.8112 13.1475 27.4575 10.7937C24.3212 7.6575 20.36 6 16 6C11.64 6 7.67874 7.6575 4.54249 10.7937C2.18874 13.1475 1.12499 15.5 1.08624 15.595C1.02938 15.7229 1 15.8613 1 16.0012C1 16.1412 1.02938 16.2796 1.08624 16.4075C1.12999 16.5062 2.18874 18.8538 4.54249 21.2075C7.67874 24.3425 11.64 26 16 26C20.36 26 24.3212 24.3425 27.4575 21.2075C29.8112 18.8538 30.87 16.5062 30.9137 16.4075C30.9706 16.2796 31 16.1412 31 16.0012C31 15.8613 30.9706 15.7229 30.9137 15.595ZM16 24C12.1525 24 8.79124 22.6012 6.00874 19.8438C4.86704 18.7084 3.89572 17.4137 3.12499 16C3.89551 14.5862 4.86686 13.2915 6.00874 12.1562C8.79124 9.39875 12.1525 8 16 8C19.8475 8 23.2087 9.39875 25.9912 12.1562C27.1352 13.2912 28.1086 14.5859 28.8812 16C27.98 17.6825 24.0537 24 16 24ZM16 10C14.8133 10 13.6533 10.3519 12.6666 11.0112C11.6799 11.6705 10.9108 12.6075 10.4567 13.7039C10.0026 14.8003 9.88377 16.0067 10.1153 17.1705C10.3468 18.3344 10.9182 19.4035 11.7573 20.2426C12.5965 21.0818 13.6656 21.6532 14.8294 21.8847C15.9933 22.1162 17.1997 21.9974 18.2961 21.5433C19.3924 21.0892 20.3295 20.3201 20.9888 19.3334C21.6481 18.3467 22 17.1867 22 16C21.9983 14.4092 21.3657 12.884 20.2408 11.7592C19.1159 10.6343 17.5908 10.0017 16 10ZM16 20C15.2089 20 14.4355 19.7654 13.7777 19.3259C13.1199 18.8864 12.6072 18.2616 12.3045 17.5307C12.0017 16.7998 11.9225 15.9956 12.0768 15.2196C12.2312 14.4437 12.6122 13.731 13.1716 13.1716C13.731 12.6122 14.4437 12.2312 15.2196 12.0769C15.9956 11.9225 16.7998 12.0017 17.5307 12.3045C18.2616 12.6072 18.8863 13.1199 19.3259 13.7777C19.7654 14.4355 20 15.2089 20 16C20 17.0609 19.5786 18.0783 18.8284 18.8284C18.0783 19.5786 17.0609 20 16 20Z"
      fill="currentColor"
    />
  </svg>
);

const EditIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
  </svg>
);

const DeleteIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M15 10V18H9V10H15ZM14 4H9.9L8.9 5H6V7H18V5H15L14 4ZM17 8H7V18C7 19.1 7.9 20 9 20H15C16.1 20 17 19.1 17 18V8Z"
      fill="currentColor"
    />
  </svg>
);
