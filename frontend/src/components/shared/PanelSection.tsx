import { useId, type ReactNode } from 'react';

export type PanelTone = 'yellow' | 'purple' | 'teal' | 'coral' | 'orange' | 'sky' | 'blush';

/**
 * One section of a single big panel: a slim header with a small colored tag, a short title and
 * its controls on the right, and a body that scrolls on its own. Sections sit edge to edge and are
 * told apart by a 2px divider, not by being separate cards.
 */
export function PanelSection({
  title,
  tone,
  leading,
  controls,
  className = '',
  headingLevel = 2,
  children,
}: {
  title: string;
  tone: PanelTone;
  /** Sits right after the title (a switch that belongs to it). */
  leading?: ReactNode;
  controls?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  const id = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={`panel-section ${className}`.trim()} aria-labelledby={id}>
      <header className="panel-head">
        <span className="panel-tag" data-tone={tone} aria-hidden="true" />
        <Heading id={id}>{title}</Heading>
        {leading}
        {controls && <div className="panel-controls">{controls}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
