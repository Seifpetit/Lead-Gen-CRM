import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

/**
 * Related views of the same list (All / Confirmed / Dismissed). Arrow keys move between tabs;
 * the content below is the panel of whichever tab is selected.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  children,
}: {
  label: string;
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === value);
    const target = tabs[(index + step + tabs.length) % tabs.length]!;
    onChange(target.id);
    list.current?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus();
  }

  return (
    <div className="tabs">
      <div className="tablist" role="tablist" aria-label={label} ref={list} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab={tab.id}
            id={`${base}-tab-${tab.id}`}
            aria-selected={tab.id === value}
            aria-controls={`${base}-panel`}
            tabIndex={tab.id === value ? 0 : -1}
            className="tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`}>
        {children}
      </div>
    </div>
  );
}
