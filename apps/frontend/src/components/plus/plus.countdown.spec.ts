// The early-bird countdown: its text, the server clock it runs on, and the
// moment it runs out.
import { act, renderHook } from '@testing-library/react';
import {
  clockOffset,
  formatCountdown,
  remainingMs,
  useCountdown,
} from '@gitroom/frontend/components/plus/plus.countdown';

const T0 = Date.parse('2026-10-18T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('formatCountdown', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatCountdown(59 * 60_000 + 42_000)).toBe('59:42');
    expect(formatCountdown(65_000)).toBe('01:05');
    expect(formatCountdown(9_000)).toBe('00:09');
  });

  it('shows hours from an hour up', () => {
    expect(formatCountdown(3_600_000)).toBe('01:00:00');
    expect(formatCountdown(24 * 3_600_000 - 1_000)).toBe('23:59:59');
    expect(formatCountdown(25 * 3_600_000)).toBe('25:00:00');
  });

  it('rounds up to the whole second and never goes below zero', () => {
    expect(formatCountdown(59_001)).toBe('01:00');
    expect(formatCountdown(1)).toBe('00:01');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5_000)).toBe('00:00');
  });
});

describe('remainingMs and clockOffset', () => {
  it('counts to expiresAt on the server clock', () => {
    // This browser runs 2 minutes behind the server.
    const offset = clockOffset(iso(T0 + 120_000), T0);
    expect(offset).toBe(120_000);
    expect(remainingMs(iso(T0 + 600_000), offset, T0)).toBe(480_000);
  });

  it('is zero once past, and for a missing or bad date', () => {
    expect(remainingMs(iso(T0 - 1), 0, T0)).toBe(0);
    expect(remainingMs(null, 0, T0)).toBe(0);
    expect(remainingMs('not a date', 0, T0)).toBe(0);
    expect(clockOffset(undefined, T0)).toBe(0);
    expect(clockOffset('nope', T0)).toBe(0);
  });
});

describe('useCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
  });
  afterEach(() => jest.useRealTimers());

  it('ticks every second and flips at the end, calling onExpire once', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() =>
      useCountdown(iso(T0 + 3_000), 0, onExpire)
    );
    expect(result.current.text).toBe('00:03');
    expect(result.current.live).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.text).toBe('00:02');

    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(result.current.live).toBe(false);
    expect(result.current.text).toBe('00:00');
    expect(onExpire).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('starts again for a new end time (the extension)', () => {
    const onExpire = jest.fn();
    const { result, rerender } = renderHook(
      ({ at }: { at: string }) => useCountdown(at, 0, onExpire),
      { initialProps: { at: iso(T0 + 1_000) } }
    );
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.live).toBe(false);
    expect(onExpire).toHaveBeenCalledTimes(1);

    rerender({ at: iso(T0 + 1_000 + 24 * 3_600_000) });
    expect(result.current.live).toBe(true);
    expect(result.current.text).toBe('24:00:00');
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.text).toBe('23:59:59');
  });

  it('runs on the server clock', () => {
    // Server is 30s ahead of this browser: 30s less is left.
    const { result } = renderHook(() =>
      useCountdown(iso(T0 + 90_000), 30_000)
    );
    expect(result.current.text).toBe('01:00');
  });

  it('is not live without an end time', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() => useCountdown(null, 0, onExpire));
    expect(result.current.live).toBe(false);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
