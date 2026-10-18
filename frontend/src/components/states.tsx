import { useT } from '../i18n/index.js';
import { describeError } from '../lib/errors.js';
import type { StringKey } from '../i18n/index.js';

export function LoadingState({ label }: { label?: string }) {
  const t = useT();
  return (
    <p className="state state-loading" role="status">
      {label ?? t('common.loading')}
    </p>
  );
}

export function ErrorState({
  error,
  onRetry,
  specific,
}: {
  error: unknown;
  onRetry?: () => void;
  specific?: Partial<Record<string, StringKey>>;
}) {
  const t = useT();
  return (
    <div className="state state-error" role="alert">
      <p>{describeError(t, error, specific)}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export { EmptyState } from './shared/EmptyState.js';
