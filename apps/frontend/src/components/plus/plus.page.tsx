'use client';

import React, { FC, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFireEvents, useTrackView } from '@gitroom/helpers/utils/use.fire.events';
import {
  useApplyPlusPlan,
  usePlusActions,
} from '@gitroom/frontend/components/plus/plus.hooks';
import { PlusPanel } from '@gitroom/frontend/components/plus/plus.panel';
import {
  NoWallet,
  useHasWallet,
  WalletPageShell,
} from '@gitroom/frontend/components/wallet/wallet.billing';

// The return from Stripe Checkout on /plus: ?plus=success&session_id=...
// records the subscription now (the webhook does it too), ?plus=cancelled
// says nothing was charged.
const PlusCheckoutReturn: FC = () => {
  const params = useSearchParams();
  const router = useRouter();
  const t = useT();
  const toaster = useToaster();
  const actions = usePlusActions();
  const apply = useApplyPlusPlan();
  const fireEvents = useFireEvents();
  const handled = useRef(false);
  const result = params.get('plus');
  const sessionId = params.get('session_id');

  useEffect(() => {
    if (handled.current || !result) return;
    handled.current = true;
    router.replace('/plus');
    if (result !== 'success' || !sessionId) {
      toaster.show(
        t('plus_checkout_cancelled', 'Checkout cancelled. Nothing was charged.'),
        'warning'
      );
      return;
    }
    (async () => {
      const { ok, body } = await actions.confirm(sessionId);
      await apply(ok ? body : undefined);
      fireEvents('plus_subscribed');
      toaster.show(
        ok && body?.subscription?.active
          ? t('plus_welcome', 'Welcome to Plus. Your plan credits are in.')
          : t(
              'plus_processing',
              'Payment received. Plus switches on in a moment.'
            )
      );
    })();
  }, [result, sessionId, router, toaster, t, actions, apply, fireEvents]);
  return null;
};

export const PlusPage: FC = () => {
  const hasWallet = useHasWallet();
  return hasWallet ? <PlusPageContent /> : <NoWallet />;
};

const PlusPageContent: FC = () => {
  useTrackView('plus_opened');
  return (
    <>
      <PlusCheckoutReturn />
      <WalletPageShell max={880} center={true}>
        <PlusPanel page={true} />
      </WalletPageShell>
    </>
  );
};
