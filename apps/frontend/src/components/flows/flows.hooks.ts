'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

// What the backend passes on from the gateway (FlowSummary in
// libraries/nestjs-libraries/src/flows/flows.service.ts).
export interface Flow {
  id: string;
  title: string;
  summary: string;
  example?: string;
  exampleVideo?: string;
  // where the sample can be seen whole as a page (the published blog post)
  exampleLink?: string;
  poster?: string;
  // every image of a sample that is a set (a carousel's slides), in order,
  // the poster first
  exampleImages?: string[];
  category?: 'video' | 'image' | 'writing' | 'marketing';
  cost?: string;
  // the credit figure of cost, from the gateway: "~10-15 credits". Missing
  // when the flow has no AI generation cost.
  costEstimate?: string;
  prompt?: string;
  free?: boolean;
  // uses paid research data, which is included with Plus; the
  // flow runs on free web research before it
  paidResearch?: boolean;
  featured?: boolean;
  // ISO date the flow was added, for the New badge and the Newest sort
  addedAt?: string;
  aspect?: '16:9' | '9:16' | '1:1' | '4:5';
  duration?: string;
  // what the agent asks the user before it starts
  inputs?: string[];
  // what the user gets at the end
  outputs?: string[];
  tags?: string[];
}

export const useFlows = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch('/flows');
    if (!response.ok) {
      throw new Error('flows');
    }
    return ((await response.json())?.flows || []) as Flow[];
  }, [fetch]);
  return useSWR<Flow[]>('flows', load, { revalidateOnFocus: false });
};

// The same catalog from GET /public/flows, for the in-app Prices page. The
// public /pricing page reads it on the server instead.
export const usePublicFlows = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch('/public/flows');
    if (!response.ok) {
      throw new Error('public-flows');
    }
    return ((await response.json())?.flows || []) as Flow[];
  }, [fetch]);
  return useSWR<Flow[]>('public-flows', load, { revalidateOnFocus: false });
};
