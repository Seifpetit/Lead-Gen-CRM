import { useEffect, useMemo } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { ApiClient } from './api/client.js';
import { ApiProvider } from './api/context.js';
import { createApi, type Api } from './api/endpoints.js';
import { Layout } from './components/Layout.js';
import { AuthProvider, useAuth } from './features/auth/AuthContext.js';
import { RequireAuth } from './features/auth/RequireAuth.js';
import { SignInPage } from './features/auth/SignInPage.js';
import { CrmPage } from './features/crm/CrmPage.js';
import { LeadGenPage } from './features/leadgen/LeadGenPage.js';
import { RunDetailPage } from './features/leadgen/RunDetailPage.js';
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
          <Route path="/leadgen" element={<LeadGenPage />} />
          <Route path="/leadgen/runs/:runId" element={<RunDetailPage />} />
          <Route path="/crm" element={<CrmPage />} />
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
