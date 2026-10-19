import type { StartBlocker } from '@lead-gen-crm/shared';

// The one place that talks HTTP. The session lives in an httpOnly cookie the browser sends on
// its own; this adds the CSRF token that state-changing requests need and turns failures into
// ApiRequestError so screens can show a clear message.

export const CSRF_HEADER = 'x-csrf-token';

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiRequestError extends Error {
  constructor(
    /** HTTP status, or 0 when the server could not be reached. */
    readonly status: number,
    /** Stable code from the server (`invalid_credentials`, `paid_runs_disabled`, ...). */
    readonly code: string,
    message?: string,
    readonly details: {
      issues?: ApiIssue[];
      blockers?: StartBlocker[];
      retryAfterSeconds?: number | null;
    } = {},
  ) {
    super(message ?? code);
    this.name = 'ApiRequestError';
  }

  get retryAfterSeconds(): number | null {
    return this.details.retryAfterSeconds ?? null;
  }
}

/** Query parameters: undefined values are dropped, lists are sent comma-separated. */
export type QueryParams = object;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  /** Sign-in, sign-up and sign-out have no session to derive a CSRF token from. */
  public?: boolean;
}

export interface ClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

function buildUrl(base: string, path: string, query?: QueryParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

async function readError(res: Response): Promise<ApiRequestError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // Not JSON (a proxy error page, say): the status alone has to do.
  }
  const retry = Number(res.headers.get('retry-after'));
  return new ApiRequestError(
    res.status,
    typeof body.error === 'string' ? body.error : `http_${res.status}`,
    typeof body.message === 'string' ? body.message : undefined,
    {
      ...(Array.isArray(body.issues) ? { issues: body.issues as ApiIssue[] } : {}),
      ...(Array.isArray(body.blockers) ? { blockers: body.blockers as StartBlocker[] } : {}),
      retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : null,
    },
  );
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly listeners = new Set<() => void>();
  private csrf: Promise<string> | null = null;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  /** An address on the API, for what cannot go through fetch (an EventSource). */
  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /** Runs when a request that needed a session comes back 401. Returns the unsubscribe. */
  onUnauthenticated(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Forget the CSRF token: it belongs to one session, so sign-in and sign-out reset it. */
  resetSession(): void {
    this.csrf = null;
  }

  private token(): Promise<string> {
    if (!this.csrf) {
      const pending = this.send<{ token: string }>('GET', '/api/auth/csrf', {}, false).then(
        (r) => r.token,
      );
      this.csrf = pending;
      pending.catch(() => {
        if (this.csrf === pending) this.csrf = null;
      });
    }
    return this.csrf;
  }

  private async send<T>(
    method: string,
    path: string,
    options: RequestOptions,
    retryCsrf: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const unsafe = method !== 'GET';
    if (unsafe && !options.public) headers[CSRF_HEADER] = await this.token();

    let res: Response;
    try {
      res = await this.fetchImpl(buildUrl(this.baseUrl, path, options.query), {
        method,
        headers,
        credentials: 'same-origin',
        ...(body !== undefined ? { body } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new ApiRequestError(0, 'network_error');
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
    const error = await readError(res);
    if (res.status === 403 && unsafe && retryCsrf && error.code === 'csrf_token_invalid') {
      // The token went stale (a new session, say): fetch a fresh one and retry once.
      this.csrf = null;
      return this.send<T>(method, path, options, false);
    }
    if (res.status === 401 && !options.public) for (const listener of this.listeners) listener();
    throw error;
  }

  request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    return this.send<T>(method, path, options, true);
  }

  /** A file from the API (an export): its bytes and the name the server gave it. */
  async download(path: string, query?: QueryParams): Promise<{ blob: Blob; fileName: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(buildUrl(this.baseUrl, path, query), {
        method: 'GET',
        credentials: 'same-origin',
      });
    } catch {
      throw new ApiRequestError(0, 'network_error');
    }
    if (!res.ok) {
      const error = await readError(res);
      if (res.status === 401) for (const listener of this.listeners) listener();
      throw error;
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export';
    return { blob: await res.blob(), fileName };
  }

  get<T>(path: string, query?: QueryParams, signal?: AbortSignal): Promise<T> {
    return this.request<T>('GET', path, {
      ...(query ? { query } : {}),
      ...(signal ? { signal } : {}),
    });
  }
}
