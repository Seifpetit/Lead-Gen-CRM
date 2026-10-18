import { ApiRequestError } from '../api/client.js';
import type { StringKey, Translate } from '../i18n/index.js';

/** A plain-language message for a failed request; `specific` maps server codes to strings. */
export function describeError(
  t: Translate,
  error: unknown,
  specific: Partial<Record<string, StringKey>> = {},
): string {
  if (error instanceof ApiRequestError) {
    const key = specific[error.code];
    if (key) return t(key);
    if (error.status === 0) return t('common.error.network');
    if (error.status >= 500) return t('common.error.server');
    if (error.status === 404) return t('common.error.notFoundResource');
    if (error.status === 403) return t('common.error.forbidden');
    // Server messages for handled failures (blockers, validation) are written for people.
    if (error.message && error.message !== error.code) return error.message;
  }
  return t('common.error.unknown');
}
