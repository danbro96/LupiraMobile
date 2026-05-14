import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth, AuthUser } from '../store/auth-store';
import { postMeRegister } from '../api/generated/me/me';

type AuthContextValue = {
  loaded: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  register: (displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthSession(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthSession must be used within an AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const loaded = useAuth(s => s.loaded);
  const token = useAuth(s => s.token);
  const user = useAuth(s => s.user);
  const load = useAuth(s => s.load);
  const setSession = useAuth(s => s.setSession);
  const clearSession = useAuth(s => s.clearSession);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const register = useCallback(
    async (displayName?: string) => {
      setBusy(true);
      setError(null);
      try {
        const envelope = await postMeRegister({
          displayName: displayName?.trim() || undefined,
        });
        const response = envelope.data;
        await setSession(response.token, {
          // Backend returns the canonical user id under `id`; keep the local
          // `AuthUser.sub` field name for back-compat with the persisted store.
          sub: response.id,
          displayName: response.displayName ?? undefined,
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [setSession],
  );

  const signOut = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  const isAuthenticated = !!token && !!user;

  const value = useMemo<AuthContextValue>(
    () => ({
      loaded,
      isAuthenticated,
      user,
      register,
      signOut,
      busy,
      error,
      clearError: () => setError(null),
    }),
    [loaded, isAuthenticated, user, register, signOut, busy, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
