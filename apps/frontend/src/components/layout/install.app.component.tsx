'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVariables } from '@gitroom/react/helpers/variable.context';

const DISMISS_KEY = 'install-app-dismissed-at';
const DISMISS_DAYS = 30;

// Chrome's install event; not in the DOM typings yet.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const dismissedRecently = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return !!at && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

// iPhone and iPad have no install prompt; people add the app from the Share
// menu. iPadOS reports itself as a Mac, so a touch screen tells them apart.
const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

// Registers the offline service worker, and on phones offers to add Studio to
// the home screen: an Install button where the browser supports it (Android),
// and Share › Add to Home Screen steps on iPhone. Closing it hides it on this
// browser for 30 days.
export const InstallAppComponent: FC = () => {
  const t = useT();
  const { environment } = useVariables();
  const [mode, setMode] = useState<'prompt' | 'ios' | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(
    null
  );

  useEffect(() => {
    if (environment === 'development' || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // No offline page on this browser; the app works the same without it.
    });
  }, [environment]);

  useEffect(() => {
    if (isInstalled() || dismissedRecently()) {
      return;
    }
    if (isIos()) {
      setMode('ios');
      return;
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
      setMode('prompt');
    };
    const onInstalled = () => setMode(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage blocked: it stays closed until the page reloads.
    }
    setMode(null);
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) {
      return;
    }
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    if (outcome === 'accepted') {
      setMode(null);
      return;
    }
    dismiss();
  }, [installEvent, dismiss]);

  if (!mode) {
    return null;
  }

  return (
    <div className="hidden mobile:flex fixed bottom-[12px] inset-x-[12px] z-[489] items-center gap-[12px] p-[12px] bg-newBgColorInner border border-newBorder rounded-[12px] shadow-lg">
      <img
        src="/icons/app/icon-192.png"
        alt=""
        className="w-[40px] h-[40px] rounded-[10px] shrink-0"
      />
      <div className="flex-1 min-w-0 text-[13px]">
        <div className="font-[600] text-newTextColor">
          {t('install_app_title', 'Get the Studio app')}
        </div>
        <div className="text-textItemBlur">
          {mode === 'ios'
            ? t(
                'install_app_ios_steps',
                'Tap Share, then Add to Home Screen.'
              )
            : t(
                'install_app_description',
                'Open Studio from your home screen, full screen.'
              )}
        </div>
      </div>
      {mode === 'prompt' && (
        <button
          type="button"
          onClick={install}
          className="h-[36px] px-[14px] rounded-[8px] bg-btnPrimary text-white text-[13px] font-[600] shrink-0"
        >
          {t('install_app_button', 'Install')}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('install_app_close', 'Close')}
        title={t('install_app_close', 'Close')}
        className="w-[24px] h-[24px] flex items-center justify-center rounded-[6px] text-textItemBlur hover:text-newTextColor hover:bg-newBgLineColor transition-colors shrink-0"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M1 1l8 8M9 1L1 9" />
        </svg>
      </button>
    </div>
  );
};
