export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    /** A short piece of the answer's body, for telling "out of credit" from "bad key". Not secret-safe: mask before storing. */
    public readonly detail?: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).origin}${new URL(url).pathname}`);
    this.name = 'HttpError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * JSON over fetch with a timeout. Errors carry the URL without its query string,
 * so tokens passed as query parameters never reach logs.
 */
export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body, timeoutMs = 30_000 } = options;
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new HttpError(res.status, url, await errorDetail(res));
  return (await res.json()) as T;
}

/** The first few hundred characters of an error body, one line; empty when it cannot be read. */
async function errorDetail(res: Response): Promise<string | undefined> {
  try {
    const text = (await res.text()).replace(/\s+/g, ' ').trim();
    return text === '' ? undefined : text.slice(0, 300);
  } catch {
    return undefined;
  }
}
