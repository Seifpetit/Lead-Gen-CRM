import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api/context.js';
import { fakeServer } from '../test/fakeServer.js';
import { FakeEventSource, lastStream, useFakeEventSource } from '../test/fakeEventSource.js';
import { run } from '../test/fixtures.js';
import { LIVE_POLL_MS, LIVE_RETRY_MS, useLiveRuns } from './useLiveRuns.js';

const going = (id: string, over = {}) => run({ id, status: 'running', finishedAt: null, ...over });

function setup(live: () => object, onEnded?: (r: unknown) => void) {
  const server = fakeServer({ 'GET /api/runs/live': live });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiProvider api={server.api}>{children}</ApiProvider>
  );
  const hook = renderHook(() => useLiveRuns(onEnded as never), { wrapper });
  return { server, ...hook };
}

afterEach(() => vi.useRealTimers());

describe('useLiveRuns with an event stream', () => {
  useFakeEventSource();

  it('opens the stream and shows the runs each event carries', async () => {
    const { result, server } = setup(() => ({ runs: [] }));
    expect(lastStream().url).toBe('/api/runs/stream');
    expect(result.current).toMatchObject({ runs: null, mode: 'connecting' });
    act(() => lastStream().emit('runs', { runs: [going('a')] }));
    expect(result.current.mode).toBe('live');
    expect(result.current.runs?.map((r) => r.id)).toEqual(['a']);
    // While the stream works nothing is polled.
    expect(server.to('GET /api/runs/live')).toHaveLength(0);
  });

  it('carries the runs that just ended, and keeps them after the stream drops and polling takes over', async () => {
    vi.useFakeTimers();
    const failed = run({ id: 'f', status: 'failed', error: 'Apify is out of credit' });
    const { result } = setup(() => ({ runs: [], ended: [failed] }));
    act(() => lastStream().emit('runs', { runs: [], ended: [failed] }));
    expect(result.current.ended.map((r) => r.id)).toEqual(['f']);
    act(() => lastStream().fail());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.mode).toBe('polling');
    expect(result.current.ended.map((r) => r.id)).toEqual(['f']);
  });

  it('ignores an event it cannot read', () => {
    const { result } = setup(() => ({ runs: [] }));
    act(() => lastStream().emit('runs', 'not json'));
    expect(result.current.runs).toBeNull();
  });

  it('falls back to asking every 3 seconds when the stream fails, then tries the stream again', async () => {
    vi.useFakeTimers();
    let answer = [going('a')];
    const { result, server } = setup(() => ({ runs: answer }));
    const first = lastStream();
    act(() => first.fail());
    expect(first.closed).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.mode).toBe('polling');
    expect(result.current.runs?.map((r) => r.id)).toEqual(['a']);
    expect(server.to('GET /api/runs/live')).toHaveLength(1);

    answer = [going('a'), going('b')];
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(server.to('GET /api/runs/live')).toHaveLength(2);
    expect(result.current.runs?.map((r) => r.id)).toEqual(['a', 'b']);

    await act(() => vi.advanceTimersByTimeAsync(LIVE_RETRY_MS));
    expect(FakeEventSource.instances.length).toBe(2);
    const calls = server.to('GET /api/runs/live').length;
    act(() => lastStream().emit('runs', { runs: [going('c')] }));
    expect(result.current).toMatchObject({ mode: 'live' });
    // Polling stopped once the stream answered.
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3));
    expect(server.to('GET /api/runs/live')).toHaveLength(calls);
  });

  it('keeps showing the last runs and reports the error when polling fails', async () => {
    vi.useFakeTimers();
    let ok = true;
    const { result } = setup(() => (ok ? { runs: [going('a')] } : { status: 500, body: {} }));
    act(() => lastStream().fail());
    await act(() => vi.advanceTimersByTimeAsync(0));
    ok = false;
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(result.current.error).not.toBeNull();
    expect(result.current.runs?.map((r) => r.id)).toEqual(['a']);
  });

  it('tells the page which run ended, with its last known state', () => {
    const ended = vi.fn();
    const { result } = setup(() => ({ runs: [] }), ended);
    act(() => lastStream().emit('runs', { runs: [going('a'), going('b')] }));
    expect(ended).not.toHaveBeenCalled();
    act(() => lastStream().emit('runs', { runs: [going('b')] }));
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended.mock.calls[0]![0]).toMatchObject({ id: 'a' });
    expect(result.current.runs?.map((r) => r.id)).toEqual(['b']);
  });

  it('closes the stream when the page goes away', () => {
    const { unmount } = setup(() => ({ runs: [] }));
    const stream = lastStream();
    unmount();
    expect(stream.closed).toBe(true);
  });
});

describe('useLiveRuns without EventSource in the browser', () => {
  it('polls straight away', async () => {
    const { result, server } = setup(() => ({ runs: [going('a')] }));
    await waitFor(() => expect(result.current.runs).not.toBeNull());
    expect(result.current.mode).toBe('polling');
    expect(server.to('GET /api/runs/live').length).toBeGreaterThan(0);
  });
});
