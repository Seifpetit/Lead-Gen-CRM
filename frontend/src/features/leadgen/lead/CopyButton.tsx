import { Copy } from 'lucide-react';
import { useToast } from '../../../components/shared/Toast.js';
import { useT, type StringKey } from '../../../i18n/index.js';

/** Copies a value to the clipboard and says so; `what` names it for the toast and the label. */
export function CopyButton({ value, what }: { value: string; what: StringKey }) {
  const t = useT();
  const toast = useToast();
  const name = t(what);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.show(t('leadView.copied', { what: name }));
    } catch {
      toast.show(t('leadView.copyFailed'), 'error');
    }
  };
  const label = t('leadView.copy', { what: name });
  return (
    <button
      type="button"
      className="button button-icon button-small"
      aria-label={label}
      title={label}
      onClick={() => void copy()}
    >
      <Copy size={14} aria-hidden="true" />
    </button>
  );
}
