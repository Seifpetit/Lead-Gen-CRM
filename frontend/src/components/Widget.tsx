import { useId, type ReactNode } from 'react';

/** A titled dashboard panel. The heading names the region for screen readers. */
export function Widget({
  title,
  actions,
  className = '',
  children,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={`widget ${className}`.trim()} aria-labelledby={id}>
      <header className="widget-header">
        <h2 id={id}>{title}</h2>
        {actions && <div className="widget-actions">{actions}</div>}
      </header>
      <div className="widget-body">{children}</div>
    </section>
  );
}
