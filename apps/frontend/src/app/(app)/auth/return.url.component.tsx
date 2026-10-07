'use client';

import { useSearchParams } from 'next/navigation';
import { FC, useCallback, useEffect } from 'react';

// Only a page on this site can be returned to: an absolute URL on the same
// origin, or a path starting with a single "/". Anything else is ignored.
export const safeReturnUrl = (value?: string | null): string | null => {
  if (!value || typeof window === 'undefined') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return null;
  }

  const isPath = trimmed.startsWith('/');
  if (!isPath && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return null;
    }
    return parsed.href;
  } catch (err) {
    return null;
  }
};

const ReturnUrlComponent: FC = () => {
  const params = useSearchParams();
  const url = params.get('returnUrl');
  useEffect(() => {
    const safe = safeReturnUrl(url);
    if (safe) {
      localStorage.setItem('returnUrl', safe);
    }
  }, [url]);
  return null;
};
export const useReturnUrl = () => {
  return {
    getAndClear: useCallback(() => {
      const data = localStorage.getItem('returnUrl');
      localStorage.removeItem('returnUrl');
      // Re-checked on the way out too, for a value stored by an older build.
      return safeReturnUrl(data);
    }, []),
  };
};
export default ReturnUrlComponent;
