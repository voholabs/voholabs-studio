'use client';

import { useEffect, useRef, useState } from 'react';

// The early-bird countdown. It always counts to the server's expiresAt, on
// the server's clock (offsetMs = server time minus this browser's).

// Server time minus this browser's, from the server's "now" when the answer
// was read. 0 when it can't be read.
export const clockOffset = (serverNow?: string | null, readAt = Date.now()) => {
  const server = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(server) ? server - readAt : 0;
};

// Milliseconds left until expiresAt, never below 0.
export const remainingMs = (
  expiresAt: string | null | undefined,
  offsetMs = 0,
  now = Date.now()
) => {
  const end = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(end)) {
    return 0;
  }
  return Math.max(0, end - (now + offsetMs));
};

// "59:42" under an hour, "23:59:42" from an hour up. Whole seconds, rounded
// up, so it never shows 00:00 while time is left.
export const formatCountdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours >= 1
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
};

// Ticks once a second until expiresAt, then calls onExpire once (to read the
// plan again: the server may answer with an extended end). Returns the time
// left and its text.
export const useCountdown = (
  expiresAt: string | null | undefined,
  offsetMs = 0,
  onExpire?: () => void
) => {
  const [now, setNow] = useState(() => Date.now());
  const left = remainingMs(expiresAt, offsetMs, now);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (!expiresAt || remainingMs(expiresAt, offsetMs) <= 0) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, offsetMs]);

  useEffect(() => {
    if (expiresAt && left <= 0 && firedFor.current !== expiresAt) {
      firedFor.current = expiresAt;
      expireRef.current?.();
    }
  }, [expiresAt, left]);

  return { left, live: left > 0, text: formatCountdown(left) };
};
