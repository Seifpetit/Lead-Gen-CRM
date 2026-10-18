import { useT } from '../../i18n/index.js';
import { ApifyLogWidget } from './ApifyLogWidget.js';

export function LogsPage() {
  const t = useT();
  return (
    <main id="main" className="page">
      <h1>{t('side.logs')}</h1>
      <div className="dashboard single">
        <ApifyLogWidget refreshKey={0} />
      </div>
    </main>
  );
}
