import { afterEach, beforeEach } from 'vitest';

type Listener = (event: MessageEvent<string>) => void;

/** A stand-in for the browser's EventSource that a test can push events into. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Listener[]>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  /** The server sends an event. */
  emit(type: string, data: unknown) {
    for (const l of this.listeners.get(type) ?? [])
      l({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent<string>);
  }
  /** The connection breaks. */
  fail() {
    this.onerror?.();
  }
}

/** Installs the fake as window.EventSource for each test and clears it afterwards. */
export function useFakeEventSource() {
  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  });
  afterEach(() => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  });
}

export const lastStream = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
