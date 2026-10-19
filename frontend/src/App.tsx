import { useEffect, useMemo } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { ApiClient } from './api/client.js';
import { ApiProvider } from './api/context.js';
import { createApi, type Api } from './api/endpoints.js';
import { Layout } from './components/Layout.js';
import { AuthProvider, useAuth } from './features/auth/AuthContext.js';
import { RequireAuth } from './features/auth/RequireAuth.js';
import { SignInPage } from './features/auth/SignInPage.js';
import { BoardPage } from './features/crm/BoardPage.js';
import { CrmSection } from './features/crm/CrmSection.js';
import { CostsPage } from './features/leadgen/CostsPage.js';
import { CoveragePage } from './features/leadgen/CoveragePage.js';
import { DashboardPage } from './features/leadgen/DashboardPage.js';
import { LeadPage } from './features/leadgen/LeadPage.js';
import { HelpPage, SettingsPage } from './features/leadgen/InfoPages.js';
import { LogsPage } from './features/leadgen/LogsPage.js';
import { RunsPage } from './features/leadgen/live/RunsPage.js';
import { I18nProvider, useT } from './i18n/index.js';

function NotFound() {
  const t = useT();
  return (
    <main id="main" className="page">
      <h1>{t('app.notFound.title')}</h1>
      <p>{t('app.notFound.body')}</p>
      <Link to="/leadgen">{t('app.notFound.back')}</Link>
    </main>
  );
}

function Screens() {
  return (
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/leadgen" replace />} />
          <Route path="/leadgen">
            <Route index element={<DashboardPage />} />
            <Route path="coverage" element={<CoveragePage />} />
            <Route path="costs" element={<CostsPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="runs/:runId" element={<RunsPage />} />
            <Route path="runs/:runId/leads/:leadId" element={<LeadPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="help" element={<HelpPage />} />
          </Route>
          <Route path="/crm" element={<CrmSection />}>
            <Route index element={<Navigate to="/crm/companies" replace />} />
            <Route path="companies" element={<BoardPage pipeline="companies" />} />
            <Route path="people" element={<BoardPage pipeline="people" />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}

/** Wires the API client to the auth state: a 401 anywhere signs the user out. */
function Authenticated({ api }: { api: Api }) {
  return (
    <ApiProvider api={api}>
      <AuthProvider>
        <SessionEndListener api={api} />
        <Screens />
      </AuthProvider>
    </ApiProvider>
  );
}

function SessionEndListener({ api }: { api: Api }) {
  const auth = useAuth();
  useEffect(() => {
    return api.client.onUnauthenticated(() => auth.sessionEnded());
  }, [api, auth]);
  return null;
}

export function App({ api: injected }: { api?: Api }) {
  const api = useMemo(() => injected ?? createApi(new ApiClient()), [injected]);
  return (
    <I18nProvider>
      <Authenticated api={api} />
    </I18nProvider>
  );
}
