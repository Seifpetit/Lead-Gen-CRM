import { useSearchParams } from 'react-router';
import { Tabs } from '../../components/shared/Tabs.js';
import { HealthPanel } from './health/HealthPanel.js';
import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { Card } from '../../components/shared/Card.js';
import { useAuth } from '../auth/AuthContext.js';
import { useT, type StringKey } from '../../i18n/index.js';

type SettingsTab = 'general' | 'health';

/** Settings is one panel like the Dashboard: General (account, safety) and Health, in tabs. */
export function SettingsPage() {
  const t = useT();
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: SettingsTab = params.get('tab') === 'health' ? 'health' : 'general';
  return (
    <main id="main" className="page dash-page">
      <div className="dash-panel settings-panel">
        <header className="dp-header">
          <SectionTitle level={1}>{t('side.settings')}</SectionTitle>
        </header>
        <Tabs
          label={t('settings.tabs')}
          value={tab}
          tabs={[
            { id: 'general', label: t('settings.tab.general') },
            { id: 'health', label: t('settings.tab.health') },
          ]}
          onChange={(next) => setParams(next === 'general' ? {} : { tab: next }, { replace: true })}
        >
          {tab === 'health' ? (
            <HealthPanel />
          ) : (
            <div className="settings-general">
              <Card title={t('settings.account')} className="info-card">
                <p>{t('settings.signedInAs', { email: auth.user?.email ?? '' })}</p>
                <button type="button" className="button" onClick={() => void auth.signOut()}>
                  {t('nav.signOut')}
                </button>
              </Card>
              <Card title={t('settings.safety')} className="info-card">
                <p className="muted">{t('settings.safety.body')}</p>
              </Card>
            </div>
          )}
        </Tabs>
      </div>
    </main>
  );
}

const TOPICS = ['leads', 'runs', 'cap', 'coverage', 'score'] as const;

export function HelpPage() {
  const t = useT();
  return (
    <main id="main" className="page">
      <SectionTitle level={1}>{t('side.help')}</SectionTitle>
      <Card title={t('help.title')} className="info-card">
        <dl className="help-list">
          {TOPICS.map((topic) => (
            <div key={topic}>
              <dt>{t(`help.${topic}.q` as StringKey)}</dt>
              <dd>{t(`help.${topic}.a` as StringKey)}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </main>
  );
}
