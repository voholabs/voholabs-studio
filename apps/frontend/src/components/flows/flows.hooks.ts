'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  openTopUpIfWalletRefused,
  WALLET_INLINE_REQUEST,
} from '@gitroom/frontend/components/wallet/wallet.bridge';

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

// My flows: the workspace's own flows (GET /user-flows). Flows open with
// Plus, so a 402 is not an error here: it is the locked state the page
// shows with its upgrade button.
export type UserFlowSource =
  | 'CREATED'
  | 'FORKED'
  | 'IMPORTED'
  | 'SAVED_FROM_CHAT';

export interface UserFlowSummary {
  slug: string;
  title: string;
  whenToUse: string;
  summary: string;
  category: string | null;
  cost: string | null;
  foundation: string[];
  source: UserFlowSource;
  poster: string | null;
  // A custom flow: the flow it is based on, a library flow id or "my/<slug>".
  basedOn: string | null;
  // The skills it brings in, derived from the skill links in its texts plus
  // older ones listed without a link: a skills library slug or "my/<slug>".
  skills: string[];
  shared: boolean;
  // False for a copy of a library flow: it gets no share link.
  shareable?: boolean;
  updatedAt: string;
}

export interface UserFlow extends UserFlowSummary {
  body: string;
  // What a custom flow changes or adds to its base.
  customization: string;
  parts: Record<string, string> | null;
  brandSlots: string[];
  forkedFromId: string | null;
  exampleVideo: string | null;
  version: number;
  shareUrl: string | null;
}

export interface UserFlowsState {
  locked: boolean;
  flows: UserFlowSummary[];
}

export const useUserFlows = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<UserFlowsState> => {
    const response = await fetch('/user-flows', WALLET_INLINE_REQUEST);
    if (response.status === 402) {
      return { locked: true, flows: [] };
    }
    if (!response.ok) {
      throw new Error('user-flows');
    }
    return {
      locked: false,
      flows: ((await response.json())?.flows || []) as UserFlowSummary[],
    };
  }, [fetch]);
  return useSWR<UserFlowsState>('user-flows', load, {
    revalidateOnFocus: false,
  });
};

// One of my flows whole, for the editor. Null slug: a new flow, nothing read.
export const useUserFlow = (slug: string | null) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch(
      `/user-flows/${encodeURIComponent(slug as string)}`,
      WALLET_INLINE_REQUEST
    );
    if (!response.ok) {
      throw new Error('user-flow');
    }
    return (await response.json()) as UserFlow;
  }, [fetch, slug]);
  return useSWR<UserFlow>(slug ? `user-flow-${slug}` : null, load, {
    revalidateOnFocus: false,
  });
};

// What a share link holds (GET /user-flows/shared/:token), scrubbed, and what
// the scrub changed. Null when the link was turned off or never existed.
export interface SharedFlow {
  flow: {
    title: string;
    whenToUse: string;
    summary: string;
    category: string | null;
    cost: string | null;
    foundation: string[];
    body: string;
    parts: Record<string, string> | null;
    brandSlots: string[];
    // A custom flow: the library flow it is based on, its changes to it and
    // its skills.
    basedOn: string | null;
    customization: string;
    skills: string[];
    updatedAt: string;
  };
  // The author's own skills it brings in, scrubbed; "slug" is the reference
  // in the flow ("my/<slug>"). An import copies them into My skills.
  ownSkills?: SharedUserSkill[];
  warnings: string[];
}

export interface SharedUserSkill {
  slug: string;
  name: string;
  description: string;
  body: string;
}

export const useSharedFlow = (token: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch(
      `/user-flows/shared/${encodeURIComponent(token)}`
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error('shared-flow');
    }
    return (await response.json()) as SharedFlow;
  }, [fetch, token]);
  return useSWR<SharedFlow | null>(`shared-flow-${token}`, load, {
    revalidateOnFocus: false,
  });
};

export interface UserFlowSaved {
  slug: string;
  created: boolean;
  warnings: string[];
}

export type UserFlowFields = Partial<
  Pick<UserFlow, 'title' | 'whenToUse' | 'summary' | 'body' | 'customization'>
> & {
  category?: string | null;
  basedOn?: string | null;
  // The skills listed without a skill link (older flows); the links in the
  // texts bring in the rest.
  skills?: string[];
};

// My skills: the workspace's own skills (GET /user-skills), which its flows
// bring in with a skill link to "my/<slug>". They open with Plus, like My
// flows: a 402 is the locked state.
export interface UserSkillSummary {
  slug: string;
  name: string;
  description: string;
  updatedAt: string;
}

export interface UserSkill extends UserSkillSummary {
  body: string;
}

export interface UserSkillsState {
  locked: boolean;
  skills: UserSkillSummary[];
}

export type UserSkillFields = Pick<UserSkill, 'name' | 'description' | 'body'>;

export const useUserSkills = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<UserSkillsState> => {
    const response = await fetch('/user-skills', WALLET_INLINE_REQUEST);
    if (response.status === 402) {
      return { locked: true, skills: [] };
    }
    if (!response.ok) {
      throw new Error('user-skills');
    }
    return {
      locked: false,
      skills: ((await response.json())?.skills || []) as UserSkillSummary[],
    };
  }, [fetch]);
  return useSWR<UserSkillsState>('user-skills', load, {
    revalidateOnFocus: false,
  });
};

// One of My skills whole, for its editor. Null slug: a new skill.
export const useUserSkill = (slug: string | null) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch(
      `/user-skills/${encodeURIComponent(slug as string)}`,
      WALLET_INLINE_REQUEST
    );
    if (!response.ok) {
      throw new Error('user-skill');
    }
    return (await response.json()) as UserSkill;
  }, [fetch, slug]);
  return useSWR<UserSkill>(slug ? `user-skill-${slug}` : null, load, {
    revalidateOnFocus: false,
  });
};

// The skills library (GET /skills), for the skills a flow brings in. It
// opens with Plus, so a 402 is the locked state, not an error (as in
// useUserFlows).
export interface SkillSummary {
  slug: string;
  name: string;
  summary: string;
  whenToUse: string | null;
}

export interface SkillsListState {
  locked: boolean;
  skills: SkillSummary[];
}

export const useSkillsList = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<SkillsListState> => {
    const response = await fetch('/skills', WALLET_INLINE_REQUEST);
    if (response.status === 402) {
      return { locked: true, skills: [] };
    }
    if (!response.ok) {
      throw new Error('skills');
    }
    return {
      locked: false,
      skills: ((await response.json())?.skills || []) as SkillSummary[],
    };
  }, [fetch]);
  return useSWR<SkillsListState>('skills-list', load, {
    revalidateOnFocus: false,
  });
};

// The writes on my flows and My skills. Each returns the parsed answer, or undefined when
// the request was refused (a Plus refusal opens the Plus dialog, any other
// error is shown as a toast) so the caller can stop its spinner.
export const useUserFlowActions = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const send = useCallback(
    async <T>(url: string, method: string, body?: unknown) => {
      const response = await fetch(url, {
        ...WALLET_INLINE_REQUEST,
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (await openTopUpIfWalletRefused(response)) {
        return undefined;
      }
      if (!response.ok) {
        const reason = await response
          .json()
          .then((b) => (Array.isArray(b?.message) ? b.message[0] : b?.message))
          .catch(() => undefined);
        toaster.show(
          typeof reason === 'string' && reason
            ? reason
            : t('flows_mine_failed', 'Something went wrong. Try again.'),
          'warning'
        );
        return undefined;
      }
      return (await response.json()) as T;
    },
    [fetch, toaster, t]
  );
  return {
    create: useCallback(
      (fields: UserFlowFields) =>
        send<UserFlowSaved>('/user-flows', 'POST', fields),
      [send]
    ),
    update: useCallback(
      (slug: string, fields: UserFlowFields) =>
        send<UserFlowSaved>(
          `/user-flows/${encodeURIComponent(slug)}`,
          'PATCH',
          fields
        ),
      [send]
    ),
    remove: useCallback(
      (slug: string) =>
        send<{ deleted: boolean }>(
          `/user-flows/${encodeURIComponent(slug)}`,
          'DELETE'
        ),
      [send]
    ),
    share: useCallback(
      (slug: string) =>
        send<{ url: string; token: string }>(
          `/user-flows/${encodeURIComponent(slug)}/share`,
          'POST'
        ),
      [send]
    ),
    unshare: useCallback(
      (slug: string) =>
        send<{ revoked: boolean }>(
          `/user-flows/${encodeURIComponent(slug)}/share`,
          'DELETE'
        ),
      [send]
    ),
    importShared: useCallback(
      (token: string) =>
        send<UserFlowSaved>('/user-flows/import', 'POST', { token }),
      [send]
    ),
    createSkill: useCallback(
      (fields: UserSkillFields) =>
        send<UserSkill>('/user-skills', 'POST', fields),
      [send]
    ),
    updateSkill: useCallback(
      (slug: string, fields: UserSkillFields) =>
        send<UserSkill>(
          `/user-skills/${encodeURIComponent(slug)}`,
          'PATCH',
          fields
        ),
      [send]
    ),
    removeSkill: useCallback(
      (slug: string) =>
        send<{ deleted: boolean }>(
          `/user-skills/${encodeURIComponent(slug)}`,
          'DELETE'
        ),
      [send]
    ),
  };
};
