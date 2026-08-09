'use client';

import { createContext, useContext } from 'react';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import dayjs from 'dayjs';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
export type IntegrationContextType = {
  date: dayjs.Dayjs;
  integration: Integrations | undefined;
  allIntegrations: Integrations[];
  value: Array<{
    content: string;
    id?: string;
    image?: Array<{
      path: string;
      id: string;
    }>;
  }>;
  /**
   * Set when a preview is rendered outside the editor (review mode, share
   * pages). The launch store's `current` is meaningless there — it still holds
   * whatever the last opened editor left behind — so previews must not read it
   * to decide whether they are showing a "global" post.
   */
  previewOnly?: boolean;
};
export const IntegrationContext = createContext<IntegrationContextType>({
  integration: undefined,
  value: [],
  date: newDayjs(),
  allIntegrations: [],
});
export const useIntegration = () => useContext(IntegrationContext);
