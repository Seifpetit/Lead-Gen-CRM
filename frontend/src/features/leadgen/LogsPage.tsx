import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { useT } from '../../i18n/index.js';
import { ApifyLogWidget } from './ApifyLogWidget.js';

export function LogsPage() {
  const t = useT();
  return (
    <main id="main" className="page fit">
      <SectionTitle level={1}>{t('side.logs')}</SectionTitle>
      <div className="fit-body">
        <ApifyLogWidget refreshKey={0} />
      </div>
    </main>
  );
}
