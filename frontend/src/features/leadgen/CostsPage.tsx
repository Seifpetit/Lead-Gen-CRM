import { useT } from '../../i18n/index.js';
import { CostsWidget } from './CostsWidget.js';

export function CostsPage() {
  const t = useT();
  return (
    <main id="main" className="page">
      <h1>{t('side.costs')}</h1>
      <div className="dashboard single">
        <CostsWidget refreshKey={0} />
      </div>
    </main>
  );
}
