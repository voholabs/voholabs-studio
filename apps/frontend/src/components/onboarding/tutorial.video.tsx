'use client';

import React, { FC, useEffect, useRef } from 'react';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';

// The onboarding tutorial on YouTube.
export const TUTORIAL_VIDEO_ID = 'sjUGcmvIT5I';

// How far into the video a viewer got, sent once each as `tutorial_progress`.
const MILESTONES = [10, 25, 50, 75, 90, 100];

let apiPromise: Promise<any> | undefined;

// Loads YouTube's IFrame API once per page. It calls the global
// onYouTubeIframeAPIReady when ready, so any earlier handler is kept.
const loadYouTubeApi = (): Promise<any> => {
  const w = window as any;
  if (w.YT?.Player) {
    return Promise.resolve(w.YT);
  }
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const previous = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(w.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    });
  }
  return apiPromise;
};

// The tutorial player. Reports how much of it was watched:
// `tutorial_started` on the first play, `tutorial_progress` at each milestone
// of the furthest point reached, and `tutorial_left` with that furthest
// percent and the seconds actually played when the viewer moves on.
export const TutorialVideo: FC<{ placement: string }> = ({ placement }) => {
  const fireEvents = useFireEvents();
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let player: any;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    let started = false;
    let furthest = 0;
    let played = 0;
    let lastTick = 0;
    const sent = new Set<number>();
    const props = { video_id: TUTORIAL_VIDEO_ID, placement };

    const percentOf = (seconds: number) => {
      const duration = player?.getDuration?.() || 0;
      return duration ? Math.min(100, (seconds / duration) * 100) : 0;
    };

    const record = (ended = false) => {
      const now = Date.now();
      if (lastTick) {
        played += Math.min(2, (now - lastTick) / 1000);
      }
      lastTick = now;
      const at = ended ? 100 : percentOf(player?.getCurrentTime?.() || 0);
      furthest = Math.max(furthest, at);
      for (const milestone of MILESTONES) {
        if (furthest >= milestone && !sent.has(milestone)) {
          sent.add(milestone);
          fireEvents('tutorial_progress', { ...props, percent: milestone });
        }
      }
    };

    const stopTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      lastTick = 0;
    };

    loadYouTubeApi().then((YT) => {
      if (cancelled || !holder.current) {
        return;
      }
      // YouTube swaps this node for its iframe, so React never owns it.
      const mount = document.createElement('div');
      holder.current.appendChild(mount);
      player = new YT.Player(mount, {
        videoId: TUTORIAL_VIDEO_ID,
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onStateChange: (e: { data: number }) => {
            if (e.data === YT.PlayerState.PLAYING) {
              if (!started) {
                started = true;
                fireEvents('tutorial_started', props);
              }
              if (!timer) {
                lastTick = Date.now();
                timer = setInterval(() => record(), 1000);
              }
            } else {
              if (timer) {
                record(e.data === YT.PlayerState.ENDED);
              }
              stopTimer();
            }
          },
        },
      });
    });

    let left = false;
    const leave = () => {
      if (left) {
        return;
      }
      left = true;
      if (timer) {
        record();
      }
      stopTimer();
      if (started) {
        fireEvents(
          'tutorial_left',
          {
            ...props,
            max_percent: Math.round(furthest),
            watched_seconds: Math.round(played),
          },
          { send_instantly: true }
        );
      }
    };
    // Closing the tab mid-video still reports how far the viewer got.
    window.addEventListener('pagehide', leave);

    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', leave);
      leave();
      player?.destroy?.();
    };
  }, []);

  return (
    <div className="relative w-full aspect-video rounded-[12px] overflow-hidden bg-black">
      <div
        ref={holder}
        className="absolute inset-0 [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:w-full [&_iframe]:h-full"
      />
    </div>
  );
};
