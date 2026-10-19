import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { useT } from '../../i18n/index.js';
import { CostsWidget } from './CostsWidget.js';

export function CostsPage() {
  const t = useT();
  return (
    <main id="main" className="page fit">
      <SectionTitle level={1}>{t('side.costs')}</SectionTitle>
      <div className="fit-body">
        <CostsWidget refreshKey={0} />
      </div>
    </main>
  );
}
