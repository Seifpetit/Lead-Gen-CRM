import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useApi } from '../../api/context.js';
import type { SessionUser } from '../../api/endpoints.js';

type Status = 'checking' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  user: SessionUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, inviteCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Called when any request comes back 401: the session ended. */
  sessionEnded: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [status, setStatus] = useState<Status>('checking');
  const [user, setUser] = useState<SessionUser | null>(null);

  const load = useCallback(async () => {
    try {
      setUser(await api.auth.me());
      setStatus('signedIn');
    } catch {
      setUser(null);
      setStatus('signedOut');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      async signIn(email, password) {
        await api.auth.login(email, password);
        await load();
      },
      async signUp(email, password, inviteCode) {
        await api.auth.signup(email, password, inviteCode);
        await load();
      },
      async signOut() {
        try {
          await api.auth.logout();
        } finally {
          setUser(null);
          setStatus('signedOut');
        }
      },
      sessionEnded() {
        setUser(null);
        setStatus('signedOut');
      },
    }),
    [api, load, status, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth needs an <AuthProvider>');
  return value;
}

/** The sign-in state, or null where there is no <AuthProvider> (a component shown on its own). */
export function useOptionalAuth(): AuthValue | null {
  return useContext(AuthContext);
}
