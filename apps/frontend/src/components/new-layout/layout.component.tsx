'use client';

import React, { ReactNode, useCallback, useEffect, useState } from 'react';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { Inter_Tight } from 'next/font/google';
const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

import clsx from 'clsx';
import dynamic from 'next/dynamic';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { usePathname, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { CheckPayment } from '@gitroom/frontend/components/layout/check.payment';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { ShowMediaBoxModal } from '@gitroom/frontend/components/media/media.component';
import { ShowLinkedinCompany } from '@gitroom/frontend/components/launches/helpers/linkedin.component';
import { MediaSettingsLayout } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { NewSubscription } from '@gitroom/frontend/components/layout/new.subscription';
import { Support } from '@gitroom/frontend/components/layout/support';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import {
  ApexBanner,
  useApexBanner,
} from '@gitroom/frontend/components/layout/apex.banner';
import {
  EarlyBirdBanner,
  useEarlyBirdBanner,
} from '@gitroom/frontend/components/plus/early.bird.banner';
import { CopilotKit } from '@copilotkit/react-core';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Impersonate } from '@gitroom/frontend/components/layout/impersonate';
import { AnnouncementBanner } from '@gitroom/frontend/components/layout/announcement.banner';
import { Title } from '@gitroom/frontend/components/layout/title';
import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import { ChromeExtensionComponent } from '@gitroom/frontend/components/layout/chrome.extension.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { TrialBanner } from '@gitroom/frontend/components/layout/trial.banner';
import { PreConditionComponent } from '@gitroom/frontend/components/layout/pre-condition.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import { FirstBillingComponent } from '@gitroom/frontend/components/billing/first.billing.component';
import { TrialTracker } from '@gitroom/frontend/components/layout/gtm.component';
import { RequiredTerms } from '@gitroom/frontend/components/onboarding/required.terms';
import { WalletHeader } from '@gitroom/frontend/components/wallet/wallet.header';
import {
  InstallAppComponent,
  ServiceWorkerComponent,
} from '@gitroom/frontend/components/layout/install.app.component';
import { setSentryUser } from '@gitroom/react/sentry/initialize.sentry.client';

const interTight = Inter_Tight({
  weight: ['600', '500', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

export const LayoutComponent = ({ children }: { children: ReactNode }) => {
  const fetch = useFetch();

  const { backendUrl, billingEnabled, isGeneral } = useVariables();

  // Feedback icon component attaches Sentry feedback to a top-bar icon when DSN is present
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  // the drawer only exists in the mobile layout, so leaving it closes it
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1025px)');
    const close = () => setMenuOpen(false);
    query.addEventListener('change', close);
    return () => query.removeEventListener('change', close);
  }, []);
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, []);
  const { data: user, mutate } = useSWR('/user/self', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });
  const apexBanner = useApexBanner(user?.tier === 'FREE');
  // The early-bird bar takes the Apex bar's place while it runs (also on the
  // Plus page, where it is hidden). Not over the onboarding, which shows the
  // offer itself.
  const earlyBird = useEarlyBirdBanner(
    user?.tier === 'FREE' && !user?.needsOnboarding
  );
  const topBanner =
    earlyBird.show ||
    (!earlyBird.running && apexBanner.show && !user?.needsOnboarding);

  useEffect(() => {
    setSentryUser(
      user ? { id: user.id, email: user.email, orgId: user.orgId } : null
    );
  }, [user]);

  // Until onboarding is finished the app stays on its steps, which open over
  // the calendar. The wallet and Plus stay reachable (opened in a new tab).
  // The same while the welcome credits wait on a decision.
  const holdOnOnboarding =
    !!user?.needsOnboarding || !!user?.welcomeCreditsPending;
  useEffect(() => {
    if (
      holdOnOnboarding &&
      !pathname.startsWith('/launches') &&
      !pathname.startsWith('/wallet') &&
      !pathname.startsWith('/plus')
    ) {
      window.location.href = '/launches?onboarding=true';
    }
  }, [holdOnOnboarding, pathname]);

  if (!user) return null;

  // Same again for the Terms: the app waits until the current version has been
  // agreed to. Nobody sees it while an admin is impersonating them.
  if (user.needsTerms) {
    return (
      <ContextWrapper user={user}>
        <MantineWrapper>
          <Toaster />
          <div
            className={clsx(
              'flex flex-col min-h-screen min-w-screen text-newTextColor p-[12px]',
              interTight.className
            )}
          >
            <RequiredTerms
              onDone={() => {
                // Keep a new account on its way to connecting channels; anyone
                // re-agreeing to updated Terms goes back to the app as before.
                window.location.href = searchParams.get('onboarding')
                  ? '/launches?onboarding=true'
                  : '/';
              }}
            />
          </div>
        </MantineWrapper>
      </ContextWrapper>
    );
  }

  return (
    <ContextWrapper user={user}>
      <CopilotKit
        credentials="include"
        runtimeUrl={backendUrl + '/copilot/chat'}
        useSingleEndpoint={true}
        showDevConsole={false}
      >
        <MantineWrapper>
          <ToolTip />
          <Toaster />
          <TrialTracker />
          <ServiceWorkerComponent />
          <InstallAppComponent />
          <CheckPayment check={searchParams.get('check') || ''} mutate={mutate}>
            <ShowMediaBoxModal />
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <PreConditionComponent />
            <NewSubscription />
            <ContinueProvider />
            <div
              className={clsx(
                'flex flex-col min-h-screen min-w-screen text-newTextColor p-[12px] mobile:p-[8px] mobile:pb-[80px]',
                interTight.className
              )}
            >
              <div>{user?.admin ? <Impersonate /> : <div />}</div>
              {user.tier === 'FREE' && isGeneral && billingEnabled ? (
                <FirstBillingComponent />
              ) : (
                <>
                  <AnnouncementBanner />
                  {/* Not over the onboarding, which needs the whole screen */}
                  {earlyBird.running ? (
                    earlyBird.show &&
                    earlyBird.earlyBird && (
                      <EarlyBirdBanner
                        earlyBird={earlyBird.earlyBird}
                        offset={earlyBird.offset}
                        onClose={earlyBird.dismiss}
                      />
                    )
                  ) : (
                    apexBanner.show &&
                    !user.needsOnboarding && (
                      <ApexBanner onClose={apexBanner.dismiss} />
                    )
                  )}
                  <div className="flex-1 flex gap-[8px] mobile:gap-0">
                    <Support />
                    {menuOpen && (
                      <div
                        className="hidden mobile:block fixed inset-0 bg-newBackdrop opacity-60 z-[490]"
                        onClick={() => setMenuOpen(false)}
                      />
                    )}
                    <div
                      className={clsx(
                        'flex flex-col bg-newBgColorInner w-[80px] rounded-[12px] mobile:fixed mobile:top-0 mobile:bottom-0 mobile:start-0 mobile:z-[491] mobile:rounded-none mobile:overflow-y-auto mobile:overflow-x-hidden',
                        !menuOpen && 'mobile:hidden'
                      )}
                      onClick={() => setMenuOpen(false)}
                    >
                      <div
                        id="left-menu"
                        className={clsx(
                          'fixed w-[64px] start-[20px] flex flex-1 mobile:static mobile:h-auto mobile:min-h-full mobile:mx-auto',
                          // A top bar (early bird or Apex) pushes the page
                          // down 44px; the fixed menu moves with it.
                          topBanner
                            ? 'top-[44px] h-[calc(100%-44px)]'
                            : 'top-0 h-full',
                          user?.admin && 'pt-[52px] max-h-[1000px]:w-[500px]'
                        )}
                      >
                        <div className="flex flex-col h-full gap-[32px] mobile:gap-[16px] flex-1 pt-[12px] pb-[20px] mobile:pb-[12px]">
                          <div className="flex justify-center">
                            <Logo />
                          </div>
                          <TopMenu />
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 bg-newBgLineColor rounded-[12px] overflow-hidden flex flex-col gap-[1px] blurMe">
                      <div className="relative flex bg-newBgColorInner h-[80px] mobile:h-[64px] px-[20px] mobile:px-[12px] gap-[12px] items-center">
                        <button
                          className="hidden mobile:flex items-center justify-center w-[36px] h-[36px] -ms-[6px] rounded-[8px] text-textItemBlur hover:text-newTextColor hover:bg-boxFocused"
                          onClick={() => setMenuOpen(true)}
                          aria-label="Open menu"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M3 6H21M3 12H21M3 18H21"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                        <div className="text-[24px] mobile:text-[20px] font-[600] flex flex-1 min-w-0">
                          <Title />
                        </div>
                        <div className="flex gap-[20px] mobile:gap-[8px] items-center text-textItemBlur">
                          <TrialBanner />
                          <StreakComponent />
                          <div className="w-[1px] h-[20px] bg-blockSeparator mobile:hidden" />
                          <OrganizationSelector />
                          <div className="hover:text-newTextColor">
                            <ModeComponent />
                          </div>
                          <div className="w-[1px] h-[20px] bg-blockSeparator mobile:hidden" />
                          <LanguageComponent />
                          <div className="contents mobile:hidden">
                            <ChromeExtensionComponent />
                          </div>
                          <div className="w-[1px] h-[20px] bg-blockSeparator mobile:hidden" />
                          <div className="contents mobile:hidden">
                            <AttachToFeedbackIcon />
                          </div>
                          {user.tier === 'FREE' && <WalletHeader />}
                          <NotificationComponent />
                        </div>
                      </div>
                      <div className="flex flex-1 min-w-0 gap-[1px] mobile:flex-col">
                        {children}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </CheckPayment>
        </MantineWrapper>
      </CopilotKit>
    </ContextWrapper>
  );
};
