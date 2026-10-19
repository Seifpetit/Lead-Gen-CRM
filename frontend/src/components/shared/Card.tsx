import { useId, type ReactNode } from 'react';

/**
 * The one container for every dashboard widget: a titled panel with an optional action area
 * next to the title. The heading names the region for screen readers.
 */
export function Card({
  title,
  actions,
  className = '',
  anchor,
  tone,
  children,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
  /** Element id, so other parts of the page can scroll here. */
  anchor?: string;
  /** Colour of the header band. Left out, the stylesheet picks one by the kind of card. */
  tone?: 'yellow' | 'purple' | 'teal' | 'coral' | 'orange' | 'sky' | 'blush';
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      className={`widget ${className}`.trim()}
      aria-labelledby={id}
      {...(anchor ? { id: anchor } : {})}
      {...(tone ? { 'data-tone': tone } : {})}
    >
      <header className="widget-header">
        <h2 id={id}>{title}</h2>
        {actions && <div className="widget-actions">{actions}</div>}
      </header>
      <div className="widget-body">{children}</div>
    </section>
  );
}
