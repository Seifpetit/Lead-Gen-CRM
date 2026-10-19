import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useApi } from '../../../api/context.js';
import { useT } from '../../../i18n/index.js';
import { useResource } from '../../../lib/useResource.js';
import './health.css';

const POLL_MS = 30_000;

/**
 * Shown above every screen while a service is down, a key is refused or database updates are
 * waiting: the same plain sentences as the Health tab, with a link to it. Draws nothing when
 * all is well, and nothing when the health check itself cannot be read (the app's own error
 * messages cover that).
 */
export function HealthNotice() {
  const t = useT();
  const api = useApi();
  const health = useResource(() => api.health.get(), { pollMs: POLL_MS });
  const notices = health.data?.notices ?? [];
  if (notices.length === 0) return null;
  return (
    <section className="health-notice" role="alert" aria-label={t('health.notice.label')}>
      <TriangleAlert size={16} aria-hidden="true" />
      <ul>
        {notices.map((n) => (
          <li key={n.id}>{n.message}</li>
        ))}
      </ul>
      <Link to="/leadgen/settings?tab=health">{t('health.notice.open')}</Link>
    </section>
  );
}
