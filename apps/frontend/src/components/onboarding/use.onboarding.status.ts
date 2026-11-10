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
}

// At least one document of the brief is filled.
export const briefStarted = (status?: OnboardingStatus) =>
  !!status?.brief?.documents?.some((document) => document.filled);

// The steps as the server sees them. Polled while the brief is being filled
// in, so its documents tick off as the agent saves them. Read by the onboarding and by an empty Brief page.
export const useOnboardingStatus = (enabled: boolean, poll: boolean) => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) =>
      (await (await fetch(path)).json()) as OnboardingStatus,
    [fetch]
  );
  return useSWR<OnboardingStatus>(enabled ? '/user/onboarding' : null, load, {
    refreshInterval: (latest) => (poll && !latest?.brief?.done ? 4000 : 0),
    revalidateOnFocus: true,
  });
};
