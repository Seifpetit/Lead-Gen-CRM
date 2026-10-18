import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

/** The one empty message: an icon, a title, optional text, and an optional action such as a button. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state state-empty">
      <span className="state-icon" aria-hidden="true">
        <Inbox size={22} />
      </span>
      <p className="state-title">{title}</p>
      {children && <div className="state-body">{children}</div>}
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}
