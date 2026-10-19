import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThrottled } from './useThrottled.js';

afterEach(() => vi.useRealTimers());

describe('useThrottled', () => {
  it('shows the first change at once and holds later ones until the wait is over', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { result, rerender } = renderHook(({ v }) => useThrottled(v, 1000), {
      initialProps: { v: 'a' },
    });
    expect(result.current).toBe('a');
    rerender({ v: 'b' });
    expect(result.current).toBe('b');
    rerender({ v: 'c' });
    rerender({ v: 'd' });
    expect(result.current).toBe('b');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    // Only the newest waiting value is shown.
    expect(result.current).toBe('d');
  });
});
