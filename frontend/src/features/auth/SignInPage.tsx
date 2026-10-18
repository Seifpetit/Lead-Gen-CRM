import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useApi } from '../../api/context.js';
import { ApiRequestError } from '../../api/client.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { useResource } from '../../lib/useResource.js';
import { useAuth } from './AuthContext.js';

const SIGNUP_ERRORS = new Set([
  'invite_required',
  'invalid_invite',
  'weak_password',
  'email_taken',
]);

function signInMessage(t: ReturnType<typeof useT>, error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) {
      const seconds = error.retryAfterSeconds;
      return seconds
        ? t('auth.error.tooManyAttempts', { minutes: Math.max(1, Math.ceil(seconds / 60)) })
        : t('auth.error.tooManyAttemptsNoTime');
    }
    if (error.code === 'invalid_credentials') return t('auth.error.invalidCredentials');
    if (error.code === 'invalid_request') return t('auth.error.invalidRequest');
    if (error.status === 0) return t('common.error.network');
    if (error.status >= 500) return t('common.error.server');
  }
  return t('common.error.unknown');
}

export function SignInPage() {
  const t = useT();
  const api = useApi();
  const auth = useAuth();
  const location = useLocation();
  const config = useResource(() => api.auth.config());
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  if (auth.status === 'signedIn') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/leadgen'} replace />;
  }

  const signup = config.data?.signupMode ?? null; // unknown until loaded: offer nothing
  const devLogin = config.data?.devAdminLogin === true; // local dev shortcut: no email/length block

  return (
    <main id="main" className="auth-page">
      <div className="auth-card">
        <h1>{mode === 'signin' ? t('auth.title') : t('auth.signup.title')}</h1>
        <p className="muted">{t('auth.subtitle')}</p>
        {mode === 'signin' ? (
          <SignInForm devLogin={devLogin} />
        ) : (
          <SignUpForm
            invite={signup === 'invite'}
            minLength={config.data?.minPasswordLength ?? 12}
            devLogin={devLogin}
          />
        )}
        {signup !== null && (
          <p className="auth-switch">
            {mode === 'signin' ? (
              <button type="button" className="link-button" onClick={() => setMode('signup')}>
                {signup === 'open' ? t('auth.signup.open') : t('auth.signup.invitePrompt')}
              </button>
            ) : (
              <button type="button" className="link-button" onClick={() => setMode('signin')}>
                {t('auth.signup.cancel')}
              </button>
            )}
          </p>
        )}
      </div>
    </main>
  );
}

function SignInForm({ devLogin }: { devLogin: boolean }) {
  const t = useT();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(email.trim(), password);
    } catch (err) {
      setError(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error !== null && (
        <p className="form-error" role="alert">
          {signInMessage(t, error)}
        </p>
      )}
      <label className="form-field">
        <span>{t('auth.email')}</span>
        <input
          type={devLogin ? 'text' : 'email'}
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="form-field">
        <span>{t('auth.password')}</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button type="submit" className="button button-primary" disabled={busy}>
        {busy ? t('auth.submitting') : t('auth.submit')}
      </button>
    </form>
  );
}

function SignUpForm({
  invite,
  minLength,
  devLogin,
}: {
  invite: boolean;
  minLength: number;
  devLogin: boolean;
}) {
  const t = useT();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.signUp(email.trim(), password, invite ? code.trim() : undefined);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const message =
    error instanceof ApiRequestError && SIGNUP_ERRORS.has(error.code)
      ? t(`auth.signup.error.${error.code}` as StringKey)
      : error !== null
        ? t('auth.signup.error.generic')
        : null;

  return (
    <form onSubmit={submit} noValidate>
      {message && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
      <label className="form-field">
        <span>{t('auth.email')}</span>
        <input
          type={devLogin ? 'text' : 'email'}
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <div className="form-field">
        <label htmlFor="signup-password">{t('auth.password')}</label>
        <input
          id="signup-password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={devLogin ? undefined : minLength}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-hint"
        />
        <small id="password-hint" className="muted">
          {t('auth.signup.passwordHint', { min: minLength })}
        </small>
      </div>
      {invite && (
        <label className="form-field">
          <span>{t('auth.signup.inviteCode')}</span>
          <input
            type="text"
            name="inviteCode"
            autoComplete="off"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
      )}
      <button type="submit" className="button button-primary" disabled={busy}>
        {busy ? t('auth.signup.submitting') : t('auth.signup.submit')}
      </button>
    </form>
  );
}
