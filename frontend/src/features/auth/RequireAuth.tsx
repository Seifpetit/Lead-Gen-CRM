import { Navigate, Outlet, useLocation } from 'react-router';
import { LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { useAuth } from './AuthContext.js';

/** Everything below this route needs a session; signed-out visitors are sent to sign in. */
export function RequireAuth() {
  const t = useT();
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'checking') {
    return (
      <main id="main" className="page">
        <LoadingState label={t('auth.session.checking')} />
      </main>
    );
  }
  if (auth.status === 'signedOut') {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
