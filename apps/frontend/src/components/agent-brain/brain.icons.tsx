'use client';

import { FC, ReactNode } from 'react';

// Every icon is referenced by the name a registry document carries, so adding a
// document means adding one entry here and nothing else.
const paths: Record<string, ReactNode> = {
  compass: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M10.6 5.4 9.3 9.3 5.4 10.6 6.7 6.7z" />
    </>
  ),
  briefcase: (
    <>
      <rect x="1.8" y="4.9" width="12.4" height="8.4" rx="1.6" />
      <path d="M5.7 4.9V3.6c0-.6.5-1.1 1.1-1.1h2.4c.6 0 1.1.5 1.1 1.1v1.3M1.8 8.3h12.4" />
    </>
  ),
  target: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <circle cx="8" cy="8" r="3.4" />
      <circle cx="8" cy="8" r="0.9" />
    </>
  ),
  flag: (
    <>
      <path d="M3.6 14V2.4M3.6 3.1h7.6l-1.4 2.5 1.4 2.5H3.6" />
    </>
  ),
  book: (
    <>
      <path d="M2.4 3.2c0-.5.4-.9.9-.9h3.3c.8 0 1.4.6 1.4 1.4v9.5c0-.6-.5-1.1-1.1-1.1H3.3c-.5 0-.9-.4-.9-.9z" />
      <path d="M13.6 3.2c0-.5-.4-.9-.9-.9H9.4c-.8 0-1.4.6-1.4 1.4v9.5c0-.6.5-1.1 1.1-1.1h3.6c.5 0 .9-.4.9-.9z" />
    </>
  ),
  waveform: (
    <>
      <path d="M2 8h1.4M5.1 4.6v6.8M8 2.6v10.8M10.9 5.6v4.8M14 8h-1.4" />
    </>
  ),
  palette: (
    <>
      <path d="M8 14c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.4 6 5.4c0 1.6-1.3 2.5-2.6 2.5h-1c-.8 0-1.4.6-1.4 1.4 0 .3.1.6.3.9.2.3.2.6.1.9-.2.5-.7.9-1.4.9z" />
      <circle cx="5.4" cy="7" r="0.9" />
      <circle cx="8.4" cy="5.1" r="0.9" />
    </>
  ),
  shield: (
    <>
      <path d="M8 14s5-2.2 5-5.6V4.1L8 2.1 3 4.1v4.3C3 11.8 8 14 8 14z" />
    </>
  ),
  checklist: (
    <>
      <path d="M6.6 4.6h7M6.6 8h7M6.6 11.4h7M2.6 4.6l.9.9 1.5-1.6M2.6 11.4l.9.9 1.5-1.6" />
      <circle cx="3.4" cy="8" r="0.8" />
    </>
  ),
  note: (
    <>
      <path d="M9 2.2H4.4c-.9 0-1.6.7-1.6 1.6v8.4c0 .9.7 1.6 1.6 1.6h7.2c.9 0 1.6-.7 1.6-1.6V6.4M9 2.2l4.2 4.2M9 2.2v4.2h4.2" />
    </>
  ),
  spark: (
    <>
      <path d="M8 1.8 9.5 6l4.2 1.5L9.5 9 8 13.2 6.5 9 2.3 7.5 6.5 6z" />
      <path d="M12.8 11.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
    </>
  ),
  link: (
    <>
      <path d="M6.7 8.7a2.9 2.9 0 0 0 4.4.4l2-2a2.9 2.9 0 1 0-4.1-4.1l-1.1 1.1M9.3 7.3a2.9 2.9 0 0 0-4.4-.4l-2 2a2.9 2.9 0 1 0 4.1 4.1l1.1-1.1" />
    </>
  ),
  channel: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.9 8h12.2M8 1.8c1.6 1.7 2.5 3.9 2.5 6.2S9.6 12.5 8 14.2C6.4 12.5 5.5 10.3 5.5 8s.9-4.5 2.5-6.2z" />
    </>
  ),
};

export const BrainIcon: FC<{ name: string; size?: number }> = ({
  name,
  size = 16,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {paths[name] || paths.note}
  </svg>
);
