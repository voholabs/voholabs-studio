'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface OnboardingStatus {
  channel: boolean;
  agent: boolean;
  brief: {
    done: boolean;
    documents: { key: string; label: string; filled: boolean }[];
  };
  // The welcome credits, in hundredths of a credit: what can still be
  // claimed, whether it was, and whether the agent is connected and has
  // filled at least one document of the brief.
  // Claimed or skipped is final.
  credits: {
    available: number;
    claimed: boolean;
    skipped: boolean;
    eligible: boolean;
  };
}

// At least one document of the brief is filled: enough, with the agent
// connected, for the welcome credits (the server checks the same).
export const briefStarted = (status?: OnboardingStatus) =>
  !!status?.brief?.documents?.some((document) => document.filled);

// The steps as the server sees them. Polled while the brief is being filled
// in or the credits are waiting on it, so its documents tick off as the agent
// saves them. Read by the onboarding and by an empty Brief page.
export const useOnboardingStatus = (enabled: boolean, poll: boolean) => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) =>
      (await (await fetch(path)).json()) as OnboardingStatus,
    [fetch]
  );
  return useSWR<OnboardingStatus>(enabled ? '/user/onboarding' : null, load, {
    // One filled document earns the credits, so the rest keep ticking off
    // after that.
    refreshInterval: (latest) =>
      poll &&
      (!latest?.brief?.done ||
        (!latest.credits.eligible &&
          latest.credits.available > 0 &&
          !latest.credits.claimed))
        ? 4000
        : 0,
    revalidateOnFocus: true,
  });
};
