'use client';

import { FC, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { OnboardingModal } from '@gitroom/frontend/components/onboarding/onboarding.modal';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

export const Onboarding: FC = () => {
  const query = useSearchParams();
  const modal = useModals();
  const router = useRouter();
  const modalOpen = useRef(false);
  // Until it is finished, onboarding opens by itself and cannot be closed.
  // So does a finished one while the welcome credits wait on a decision.
  const user = useUser();
  const mandatory = !!user?.needsOnboarding || !!user?.welcomeCreditsPending;

  const handleClose = useCallback(() => {
    modal.closeAll();
    router.push('/launches');
  }, [modal, router]);

  const open = useCallback(() => {
    modal.openModal({
      // One id, so a remount or a reopen never stacks a second one.
      id: 'onboarding',
      // title: t('onboarding', 'Welcome to Voholabs'),
      withCloseButton: !mandatory,
      closeOnEscape: false,
      removeLayout: true,
      askClose: !mandatory,
      fullScreen: true,
      // The modals close on Escape whatever they ask for, so an unfinished
      // onboarding opens again right after.
      onClose: mandatory ? () => setTimeout(open) : handleClose,
      children: <OnboardingModal onClose={handleClose} />,
    });
  }, [modal, mandatory, handleClose]);

  useEffect(() => {
    const onboarding = query.get('onboarding') || mandatory;
    if (!onboarding) {
      if (modalOpen.current) {
        modalOpen.current = false;
        modal.closeAll();
      }
      return;
    }
    if (modalOpen.current) {
      return;
    }
    modalOpen.current = true;
    open();
  }, [query, open, mandatory]);
  
  return null;
};
