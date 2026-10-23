'use client';

import { FC, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocalStorage } from '@mantine/hooks';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';

// A form submitted before hydration falls back to GET and puts its fields in
// the address bar. Never keep those fields, or send them anywhere.
const SENSITIVE_PARAMS = ['password', 'repeatPassword', 'email', 'token'];

export const stripSensitiveParams = (value: string) => {
  if (!value) {
    return value;
  }
  try {
    const url = new URL(value);
    SENSITIVE_PARAMS.forEach((param) => url.searchParams.delete(param));
    return url.toString();
  } catch (err) {
    return '';
  }
};

const UtmSaver: FC = () => {
  const query = useSearchParams();
  const [value, setValue] = useLocalStorage({ key: 'utm', defaultValue: '' });
  const searchParams = useSearchParams();
  const fireEvents = useFireEvents();

  // the Facebook pixel StartTrial is sent by the backend once Stripe confirms
  // the trial, firing it here as well would count it twice
  useEffect(() => {
    if (searchParams.get('check')) {
      fireEvents('purchase');
    }
  }, []);

  useEffect(() => {
    if (new URL(window.location.href).searchParams.has('password')) {
      window.history.replaceState(
        window.history.state,
        '',
        stripSensitiveParams(window.location.href)
      );
    }

    const landingUrl = localStorage.getItem('landingUrl');
    if (landingUrl) {
      return;
    }

    localStorage.setItem(
      'landingUrl',
      stripSensitiveParams(window.location.href)
    );
    localStorage.setItem('referrer', stripSensitiveParams(document.referrer));
  }, []);

  useEffect(() => {
    const utm = query.get('utm_source') || query.get('utm') || query.get('ref');
    if (utm && !value) {
      setValue(utm);
    }
  }, [query, value]);

  return <></>;
};

export const useUtmUrl = () => {
  const [value] = useLocalStorage({ key: 'utm', defaultValue: '' });
  return value || '';
};
export default UtmSaver;
