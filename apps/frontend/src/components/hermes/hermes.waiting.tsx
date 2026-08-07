'use client';

import { FC, useEffect, useState } from 'react';
import clsx from 'clsx';
import { HermesStep } from '@gitroom/frontend/components/hermes/use.hermes.chat';

// Shown only until the agent names its first step, so a slow start still reads
// as work happening.
const WORDS = [
  'Thinking',
  'Pondering',
  'Working',
  'Considering',
  'Digging in',
  'Piecing it together',
];

const ROTATE_MS = 2400;

const Dots = () => (
  <span className="inline-flex gap-[3px] items-center">
    <span className="w-[5px] h-[5px] rounded-full bg-warm animate-pulse" />
    <span
      className="w-[5px] h-[5px] rounded-full bg-warm animate-pulse"
      style={{ animationDelay: '150ms' }}
    />
    <span
      className="w-[5px] h-[5px] rounded-full bg-warm animate-pulse"
      style={{ animationDelay: '300ms' }}
    />
  </span>
);

const Tick = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="11"
    height="11"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13.3 4L6 11.3 2.7 8" />
  </svg>
);

// A trace of what the agent is doing — step labels only. The model's actual
// reasoning is deliberately never rendered.
export const HermesWaiting: FC<{ activity?: HermesStep[] }> = ({ activity }) => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % WORDS.length),
      ROTATE_MS
    );

    return () => clearInterval(timer);
  }, []);

  if (!activity?.length) {
    return (
      <div className="flex items-center gap-[8px] text-textItemBlur">
        <Dots />
        <span className="text-[13px]">{WORDS[index]}…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[6px]">
      {activity.map((step) => (
        <div
          key={step.id}
          className={clsx(
            'flex items-center gap-[8px] text-[13px]',
            step.done ? 'text-textItemBlur' : 'text-warm'
          )}
        >
          <span className="w-[14px] flex justify-center">
            {step.done ? <Tick /> : <Dots />}
          </span>
          <span>
            {!!step.emoji && <span className="me-[6px]">{step.emoji}</span>}
            {step.label}
            {step.done ? '' : '…'}
          </span>
        </div>
      ))}
    </div>
  );
};
