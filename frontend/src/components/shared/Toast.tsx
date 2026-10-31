import { X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useT } from '../../i18n/index.js';

export type ToastKind = 'success' | 'error' | 'warning';

/** A button on a toast (Undo): it runs once and closes the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction | undefined;
}

export interface Toasts {
  /** A toast with an action stays long enough to be used (8 seconds) unless `lifetimeMs` says. */
  show: (
    message: string,
    kind?: ToastKind,
    options?: { action?: ToastAction; lifetimeMs?: number },
  ) => void;
}

const ToastContext = createContext<Toasts | null>(null);

const LIFETIME_MS: Record<ToastKind, number> = { success: 4_000, warning: 8_000, error: 8_000 };
const ACTION_LIFETIME_MS = 8_000;

/** Short confirmations and problems in the corner. Errors and warnings are announced at once. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((all) => all.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (
      message: string,
      kind: ToastKind = 'success',
      options: { action?: ToastAction; lifetimeMs?: number } = {},
    ) => {
      const id = next.current++;
      setItems((all) => [...all.slice(-3), { id, kind, message, action: options.action }]);
      const lifetime =
        options.lifetimeMs ?? (options.action ? ACTION_LIFETIME_MS : LIFETIME_MS[kind]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), lifetime),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const live = timers.current;
    return () => live.forEach((timer) => clearTimeout(timer));
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label={t('toast.label')}>
        {items.map((item) => (
          <div
            key={item.id}
            className={`toast toast-${item.kind}`}
            role={item.kind === 'success' ? 'status' : 'alert'}
          >
            <span>{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="button toast-action"
                onClick={() => {
                  const run = item.action!.onClick;
                  dismiss(item.id);
                  run();
                }}
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={t('toast.dismiss')}
              onClick={() => dismiss(item.id)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Toasts {
  const toasts = useContext(ToastContext);
  if (!toasts) throw new Error('useToast needs a ToastProvider above it');
  return toasts;
}
