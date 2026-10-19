import { Outlet, useLocation, useNavigate } from 'react-router';
import { Tabs } from '../../components/shared/Tabs.js';
import { useT } from '../../i18n/index.js';

type Board = 'companies' | 'people';

/** The CRM section: its title and the tabs that switch between the two boards. */
export function CrmSection() {
  const t = useT();
  const navigate = useNavigate();
  const current: Board = useLocation().pathname.startsWith('/crm/people') ? 'people' : 'companies';
  return (
    <main id="main" className="page">
      <h1>{t('crm.title')}</h1>
      <Tabs
        label={t('crm.tabs.label')}
        tabs={[
          { id: 'companies', label: t('crm.tab.companies') },
          { id: 'people', label: t('crm.tab.people') },
        ]}
        value={current}
        onChange={(id) => void navigate(`/crm/${id}`)}
      >
        <Outlet />
      </Tabs>
    </main>
  );
}
