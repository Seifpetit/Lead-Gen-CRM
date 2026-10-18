import { requestJson, type RequestOptions } from '../httpClient.js';

/** JSON over HTTP. Adapters take one so tests can serve recorded fixtures instead. */
export type HttpJson = <T>(url: string, options?: RequestOptions) => Promise<T>;

export const defaultHttp: HttpJson = requestJson;

/** Injected clock, so fetchedAt values are reproducible in tests. */
export type Clock = () => Date;
