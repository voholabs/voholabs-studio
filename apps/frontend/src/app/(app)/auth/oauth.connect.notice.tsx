'use client';

import { FC, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

// An AI assistant (Claude, ChatGPT) sent a signed-out user to the consent
// screen, and the proxy brought them here with its query. The query is kept for
// the session, so the notice stays when they switch between sign-up and log-in.
const KEY = 'oauth_connect';

const readStored = () => {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
};

const useConnectingApp = (query: string) => {
  const fetch = useFetch();
  return useSWR<{ app?: { name?: string; redirectHost?: string } }>(
    query ? `oauth-connect-${query}` : null,
    async () => (await fetch(`/oauth/authorize?${query}`)).json(),
    { revalidateOnFocus: false }
  );
};

const OAuthConnectNotice: FC = () => {
  const params = useSearchParams();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (params.get('client_id') && params.get('response_type')) {
      const fresh = params.toString();
      try {
        sessionStorage.setItem(KEY, fresh);
      } catch {}
      setQuery(fresh);
      return;
    }
    setQuery(readStored());
  }, [params]);

  const { data } = useConnectingApp(query);
  if (!query) {
    return null;
  }

  const name = data?.app?.name || 'your AI assistant';
  return (
    <div className="rounded-[12px] border border-[#20808D] bg-[#20808D]/10 p-[16px] flex flex-col gap-[4px]">
      <div className="text-[16px] font-[600]">
        Connecting {name} to Voholabs Studio
      </div>
      <div className="text-[14px] text-gray-400">
        Sign in or create a free account. Next, you choose which workspace{' '}
        {name} can use, and you go back to{' '}
        {data?.app?.redirectHost || 'the app'}.
      </div>
    </div>
  );
};

export const clearOAuthConnect = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
};

export default OAuthConnectNotice;
