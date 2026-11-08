'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import {
  fromUtc,
  newDayjs,
} from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { ArrowIcon, CARD } from '@gitroom/frontend/components/wallet/wallet.ui';
import {
  UpcomingPost,
  useUpcomingPosts,
} from '@gitroom/frontend/components/home/home.hooks';
import {
  useFlows,
  useUserFlows,
} from '@gitroom/frontend/components/flows/flows.hooks';
import { MyFlowsSection } from '@gitroom/frontend/components/flows/flows.mine';
import { useOpenNewCustomFlow } from '@gitroom/frontend/components/flows/flows.new';
import {
  FlowCard,
  usePreviewPolicy,
} from '@gitroom/frontend/components/flows/flows.card';
import { FlowDrawer } from '@gitroom/frontend/components/flows/flows.drawer';
import {
  relatedFlows,
  sortFlows,
} from '@gitroom/frontend/components/flows/flows.page';

// Home: what Voho does in one line, the next post going out, and flows to
// make the next ones with.

const LIBRARY_FLOWS = 6;
const MY_FLOWS = 3;

const LINK_BUTTON =
  'self-start h-[36px] px-[14px] rounded-[8px] bg-btnPrimary hover:brightness-110 text-white text-[13px] font-[600] inline-flex items-center gap-[8px] transition-all';

const SectionLink: FC<{ href: string; label: string }> = ({ href, label }) => (
  <Link
    href={href}
    className="flex items-center gap-[6px] text-[13px] text-textItemBlur hover:text-newTextColor"
  >
    {label} <ArrowIcon />
  </Link>
);

const HowItWorks: FC = () => {
  const t = useT();
  const steps = [
    {
      href: '/brief',
      title: t('brief', 'Brief'),
      body: t('home_step_brief', 'Your brand, audience and voice'),
    },
    {
      href: '/flows',
      title: t('flows', 'Flows'),
      body: t('home_step_flows', 'Ready-made jobs your agent runs'),
    },
    {
      href: '/launches',
      title: t('calendar', 'Calendar'),
      body: t('home_step_calendar', 'Where your posts are scheduled'),
    },
  ];
  return (
    <section className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[6px]">
        <h2 className="text-[22px] font-[700]">
          {t('home_title', 'How Voho works')}
        </h2>
        <div className="text-[14px] leading-[1.5] text-textItemBlur max-w-[640px]">
          {t(
            'home_intro',
            'Your brief (brand, audience, voice) steers an agent that makes content with Flows and schedules it on your calendar.'
          )}
        </div>
      </div>
      <ol className="grid gap-[12px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr))]">
        {steps.map((step, index) => (
          <li key={step.href}>
            <Link
              href={step.href}
              className={`${CARD} flex items-center gap-[12px] p-[14px] bg-newTableHeader hover:border-tealText transition-colors`}
            >
              <span className="w-[28px] h-[28px] shrink-0 rounded-full bg-tealSoft text-tealText text-[13px] font-[700] flex items-center justify-center">
                {index + 1}
              </span>
              <span className="flex flex-col gap-[2px] min-w-0 flex-1">
                <span className="text-[15px] font-[700]">{step.title}</span>
                <span className="text-[13px] text-textItemBlur truncate">
                  {step.body}
                </span>
              </span>
              <span className="text-textItemBlur">
                <ArrowIcon />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
};

// The calendar's own address for the day the post goes out.
const calendarDayUrl = (post: UpcomingPost) => {
  const day = fromUtc(post.publishDate).format('YYYY-MM-DD');
  return `/launches?startDate=${day}&endDate=${day}&display=day`;
};

const UpcomingPostRow: FC<{ post: UpcomingPost; next: boolean }> = ({
  post,
  next,
}) => {
  const t = useT();
  const date = fromUtc(post.publishDate);
  const time = date.format(isUSCitizen() ? 'hh:mm A' : 'HH:mm');
  const text =
    stripHtmlValidation('none', post.content, false, true, false) ||
    t('no_content', 'no content');
  return (
    <Link
      href={calendarDayUrl(post)}
      className="flex items-start gap-[12px] p-[14px] hover:bg-newBgLineColor transition-colors"
    >
      <div className="relative min-w-[36px]">
        <img
          className="w-[36px] h-[36px] rounded-full object-cover"
          src={post.integration.picture || '/no-picture.jpg'}
          alt={post.integration.name}
        />
        <img
          className="w-[16px] h-[16px] rounded-full absolute -bottom-[2px] -end-[2px] border border-fifth"
          src={`/icons/platforms/${post.integration.providerIdentifier}.png`}
          alt={post.integration.providerIdentifier}
        />
      </div>
      <div className="flex flex-col gap-[4px] min-w-0 flex-1">
        <div className="flex items-center gap-[8px] flex-wrap">
          <span className="text-[14px] font-[600] truncate">
            {post.integration.name}
          </span>
          {next && (
            <span className="inline-flex items-center h-[20px] px-[8px] rounded-full text-[11px] font-[600] bg-tealSoft text-tealText">
              {t('next_up', 'Next up')}
            </span>
          )}
        </div>
        <div className="text-[12px] text-textItemBlur">
          {date.format('ddd, MMM D')} {time}{' '}
          <span className="opacity-40">•</span> {date.fromNow()}
        </div>
        <div className="text-[13px] leading-[1.4] line-clamp-2 break-words">
          {text}
        </div>
      </div>
    </Link>
  );
};

const NextPostSkeleton: FC = () => (
  <div className="flex items-start gap-[12px] p-[14px]">
    <div className="w-[36px] h-[36px] shrink-0 rounded-full bg-newBgLineColor animate-pulse" />
    <div className="flex flex-col gap-[8px] flex-1">
      <div className="h-[14px] w-[40%] rounded-[4px] bg-newBgLineColor animate-pulse" />
      <div className="h-[12px] w-[30%] rounded-[4px] bg-newBgLineColor animate-pulse" />
      <div className="h-[12px] w-[80%] rounded-[4px] bg-newBgLineColor animate-pulse" />
    </div>
  </div>
);

const EmptyNextPost: FC<{
  title: string;
  body: string;
  action: string;
}> = ({ title, body, action }) => (
  <div className="flex flex-col gap-[10px] p-[16px]">
    <div className="flex flex-col gap-[4px]">
      <div className="text-[15px] font-[700]">{title}</div>
      <div className="text-[13px] leading-[1.5] text-textItemBlur">{body}</div>
    </div>
    <Link href="/launches" className={LINK_BUTTON}>
      {action}
    </Link>
  </div>
);

const NextPostSection: FC = () => {
  const t = useT();
  const { data: integrations, isLoading: integrationsLoading } =
    useIntegrationList();
  const { data, isLoading, error, mutate } = useUpcomingPosts();
  // The list is from now on when it loads; drop any that went out since and
  // load the ones after them.
  const posts = useMemo(() => {
    const now = newDayjs();
    return (data?.posts || []).filter((post) =>
      fromUtc(post.publishDate).isAfter(now)
    );
  }, [data]);
  const wentOut = !!data && posts.length < data.posts.length;
  useEffect(() => {
    if (wentOut) {
      mutate();
    }
  }, [wentOut, mutate]);

  const body = () => {
    if (
      (isLoading && !data) ||
      (integrationsLoading && !integrations?.length)
    ) {
      return <NextPostSkeleton />;
    }
    if (!integrations?.length) {
      return (
        <EmptyNextPost
          title={t('home_no_channels', 'No channels connected yet')}
          body={t(
            'home_no_channels_body',
            'Connect a social channel so your posts have somewhere to go.'
          )}
          action={t(
            'go_to_the_calendar_to_add_channels',
            'Go to the calendar to add channels'
          )}
        />
      );
    }
    if (error || !posts.length) {
      return (
        <EmptyNextPost
          title={t('home_nothing_scheduled', 'Nothing scheduled yet')}
          body={t(
            'home_nothing_scheduled_body',
            'Create a post on the calendar, or run a flow and let your agent schedule it.'
          )}
          action={t('home_open_calendar', 'Open the calendar')}
        />
      );
    }
    return (
      <div className="flex flex-col divide-y divide-newTableBorder">
        {posts.map((post, index) => (
          <UpcomingPostRow key={post.id} post={post} next={index === 0} />
        ))}
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-[12px]">
      <div className="flex items-center gap-[12px]">
        <h2 className="flex-1 text-[18px] font-[700]">
          {t('home_next_post', 'Next post')}
        </h2>
        <SectionLink
          href="/launches"
          label={t('home_see_calendar', 'See the calendar')}
        />
      </div>
      <div
        className={`${CARD} bg-newTableHeader overflow-hidden max-w-[720px]`}
      >
        {body()}
      </div>
    </section>
  );
};

export const HomePage: FC = () => {
  const t = useT();
  const { data, isLoading } = useFlows();
  const { data: mine, mutate: refreshMine } = useUserFlows();
  const locked = !!mine?.locked;
  const refresh = useCallback(() => {
    refreshMine();
  }, [refreshMine]);
  const customize = useOpenNewCustomFlow();

  // The drawer opens here, over Home, like it does on the Flows page.
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);

  // Muted previews play on the hovered card, on desktop.
  const policy = usePreviewPolicy();
  const [hovered, setHovered] = useState<string | null>(null);

  const flows = useMemo(() => sortFlows(data || [], 'featured'), [data]);
  const selected = open ? flows.find((flow) => flow.id === open) : undefined;
  const related = useMemo(
    () => relatedFlows(flows, selected),
    [flows, selected]
  );

  return (
    <>
      <div className="bg-newBgColorInner flex-1 relative min-w-0">
        <div className="absolute inset-0 overflow-y-auto overflow-x-hidden p-[20px] flex flex-col gap-[28px]">
          <HowItWorks />
          <NextPostSection />
          {!!mine?.flows.length && (
            <MyFlowsSection
              state={mine}
              library={data}
              onChanged={refresh}
              limit={MY_FLOWS}
            />
          )}
          <section className="flex flex-col gap-[12px]">
            <div className="flex items-center gap-[12px]">
              <h2 className="flex-1 text-[18px] font-[700]">
                {t('flows_library_title', 'Voho library')}
              </h2>
              <SectionLink
                href="/flows"
                label={t('home_see_all_flows', 'See all flows')}
              />
            </div>
            {isLoading && !data ? (
              <div className="grid gap-[12px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))]">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="aspect-[4/3] min-h-[220px] rounded-[12px] bg-newBgLineColor animate-pulse"
                  />
                ))}
              </div>
            ) : !flows.length ? (
              <div className="text-[14px] text-textItemBlur py-[20px]">
                {t('flows_none', 'No flows yet. New ones land here first.')}
              </div>
            ) : (
              <div className="grid gap-[12px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))] mobile:[grid-template-columns:repeat(auto-fill,minmax(min(100%,172px),1fr))]">
                {flows.slice(0, LIBRARY_FLOWS).map((flow) => {
                  const key = `home:${flow.id}`;
                  return (
                    <FlowCard
                      key={flow.id}
                      flow={flow}
                      locked={locked}
                      playKey={key}
                      playing={policy.hover && hovered === key}
                      onOpen={setOpen}
                      onHover={policy.hover ? setHovered : undefined}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
      {!!selected && (
        <FlowDrawer
          key={selected.id}
          flow={selected}
          locked={locked}
          onCustomize={mine && !locked ? customize : undefined}
          related={related}
          onClose={close}
          onOpen={setOpen}
        />
      )}
    </>
  );
};
