import { FC } from 'react';

export const LockIcon: FC<{ size?: number }> = ({ size = 10 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M7 11V7.5a5 5 0 0 1 10 0V11M6.5 21h11c1.4 0 2.1 0 2.635-.272a2.5 2.5 0 0 0 1.093-1.093C21.5 19.1 21.5 18.4 21.5 17v-1c0-1.4 0-2.1-.272-2.635a2.5 2.5 0 0 0-1.093-1.093C19.6 12 18.9 12 17.5 12h-11c-1.4 0-2.1 0-2.635.272a2.5 2.5 0 0 0-1.093 1.093C2.5 13.9 2.5 14.6 2.5 16v1c0 1.4 0 2.1.272 2.635a2.5 2.5 0 0 0 1.093 1.093C4.4 21 5.1 21 6.5 21Z"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CoinsIcon: FC<{ size?: number }> = ({ size = 12 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <ellipse cx="9" cy="6.5" rx="6" ry="2.75" stroke="currentColor" strokeWidth="2" />
    <path
      d="M3 6.5v5c0 1.52 2.69 2.75 6 2.75M3 11.5v5c0 1.52 2.69 2.75 6 2.75M15 6.5v2"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <ellipse cx="15" cy="13" rx="6" ry="2.75" stroke="currentColor" strokeWidth="2" />
    <path
      d="M9 13v5c0 1.52 2.69 2.75 6 2.75s6-1.23 6-2.75v-5"
      stroke="currentColor"
      strokeWidth="2"
    />
  </svg>
);

export const InfoIcon: FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M12 16.5V11M12 7.6v-.1"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

export const CheckIcon: FC<{ size?: number }> = ({ size = 12 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M20 6L9 17L4 12"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PlusIcon: FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 5v14M5 12h14"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const GiftIcon: FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M20 12v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5V12M2.5 7.5h19V12h-19V7.5ZM12 22V7.5M12 7.5H7.75a2.5 2.5 0 1 1 0-5C11 2.5 12 7.5 12 7.5ZM12 7.5h4.25a2.5 2.5 0 1 0 0-5C13 2.5 12 7.5 12 7.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
