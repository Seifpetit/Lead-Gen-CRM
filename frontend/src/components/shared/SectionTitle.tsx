import type { ReactNode } from 'react';

/** A page or section heading with an optional line of explanation under it. */
export function SectionTitle({
  level = 2,
  children,
  hint,
}: {
  level?: 1 | 2 | 3;
  children: ReactNode;
  hint?: ReactNode;
}) {
  const Heading = `h${level}` as const;
  return (
    <div className="section-title">
      <Heading>{children}</Heading>
      {hint && <p className="muted">{hint}</p>}
    </div>
  );
}
