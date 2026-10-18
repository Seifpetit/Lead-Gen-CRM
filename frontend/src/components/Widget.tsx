import { useId, type ReactNode } from 'react';

/** A titled dashboard panel. The heading names the region for screen readers. */
export function Widget({
  title,
  actions,
  className = '',
  anchor,
  children,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
  /** Element id, so other widgets can scroll here. */
  anchor?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      className={`widget ${className}`.trim()}
      aria-labelledby={id}
      {...(anchor ? { id: anchor } : {})}
    >
      <header className="widget-header">
        <h2 id={id}>{title}</h2>
        {actions && <div className="widget-actions">{actions}</div>}
      </header>
      <div className="widget-body">{children}</div>
    </section>
  );
}
