import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Sentry from '@sentry/react-native';
import { DEFAULT_MTG_API_URL } from '../config';
import { refreshTokens, RefreshError } from '../auth/oidc';
import { logAuth } from '../auth/authDebug';

// One shared in-flight refresh. Concurrent callers await it instead of each POSTing the
// refresh token — with Authentik rotation a second send replays an already-rotated token,
// which fails and forces an unexpected logout. See refreshIfNeeded.
let refreshing: Promise<string | null> | null = null;

const KEY_MTG_API_URL = 'lupira.mtg.apiUrl';
// New keys (the PoC device token lived under `lupira.mtg.deviceToken`; leaving it untouched
// means a pre-SSO install loads with token=null → the login screen, not a dead bearer).
const KEY_TOKEN = 'lupira.mtg.accessToken';
const KEY_REFRESH = 'lupira.mtg.refreshToken';
const KEY_EXPIRES = 'lupira.mtg.expiresAt';
const KEY_USER_SUB = 'lupira.mtg.userSub';
const KEY_USER_NAME = 'lupira.mtg.userName';

export type AuthUser = {
  /** The caller's email (= OIDC subject convention; used as the actor + identity). */
  sub: string;
  displayName?: string;
  /** Derived from the `groups` claim at sign-in; in-memory only (re-read each login). */
  isAdmin?: boolean;
};

export type Session = {
  accessToken: string;
  refreshToken?: string | null;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
};

type AuthState = {
  loaded: boolean;
  mtgApiUrl: string;
  token: string | null; // access token — read by the api mutator
  refreshToken: string | null;
  expiresAt: number | null;
  user: AuthUser | null;
};

type AuthActions = {
  load: () => Promise<void>;
  setApiUrl: (mtgApiUrl: string) => Promise<void>;
  setSession: (session: Session, user: AuthUser) => Promise<void>;
  /** Wipe the session. `reason: 'expired'` marks an involuntary logout (revoked/expired grant);
   *  a plain call (deliberate sign-out) is silent. */
  clearSession: (opts?: { reason?: 'expired' }) => Promise<void>;
  /** Refresh the access token if it's expired/near-expiry; returns the live access token.
   *  `force: true` bypasses the freshness check (reactive refresh after a server 401) and, when
   *  the session is definitively un-refreshable, clears it rather than handing back a dead token.
   *  `sentToken` (forced callers) is the token the 401'd request sent — if the session token has
   *  already changed since, the refresh is skipped and the current token returned. */
  refreshIfNeeded: (opts?: { force?: boolean; sentToken?: string }) => Promise<string | null>;
  isAuthenticated: () => boolean;
};

export const useAuth = create<AuthState & AuthActions>((set, get) => ({
  loaded: false,
  mtgApiUrl: DEFAULT_MTG_API_URL,
  token: null,
  refreshToken: null,
  expiresAt: null,
  user: null,

  load: async () => {
    const [mtgApiUrl, token, refreshToken, expiresAt, userSub, userName] = await Promise.all([
      SecureStore.getItemAsync(KEY_MTG_API_URL),
      SecureStore.getItemAsync(KEY_TOKEN),
      SecureStore.getItemAsync(KEY_REFRESH),
      SecureStore.getItemAsync(KEY_EXPIRES),
      SecureStore.getItemAsync(KEY_USER_SUB),
      SecureStore.getItemAsync(KEY_USER_NAME),
    ]);
    set({
      loaded: true,
      mtgApiUrl: mtgApiUrl || DEFAULT_MTG_API_URL,
      token: token ?? null,
      refreshToken: refreshToken ?? null,
      expiresAt: expiresAt ? Number(expiresAt) : null,
      user: userSub ? { sub: userSub, displayName: userName ?? undefined } : null,
    });
    if (userSub) Sentry.setUser({ id: userSub });
  },

  setApiUrl: async mtgApiUrl => {
    await SecureStore.setItemAsync(KEY_MTG_API_URL, mtgApiUrl);
    set({ mtgApiUrl });
  },

  setSession: async (session, user) => {
    // In-memory state first: a rotated refresh token must survive even if persistence fails —
    // the old one is already invalid server-side, so losing the new one here would strand the
    // session (the next refresh would replay a dead token → definitive 400 → forced logout).
    set({
      token: session.accessToken,
      refreshToken: session.refreshToken ?? null,
      expiresAt: session.expiresAt,
      user,
    });
    Sentry.setUser({ id: user.sub });
    try {
      await Promise.all([
        SecureStore.setItemAsync(KEY_TOKEN, session.accessToken),
        session.refreshToken
          ? SecureStore.setItemAsync(KEY_REFRESH, session.refreshToken)
          : SecureStore.deleteItemAsync(KEY_REFRESH),
        SecureStore.setItemAsync(KEY_EXPIRES, String(session.expiresAt)),
        SecureStore.setItemAsync(KEY_USER_SUB, user.sub),
        user.displayName
          ? SecureStore.setItemAsync(KEY_USER_NAME, user.displayName)
          : SecureStore.deleteItemAsync(KEY_USER_NAME),
      ]);
    } catch (e) {
      // The live session is intact in memory; only the persisted copy is stale. A restart could
      // replay an already-rotated refresh token, so leave a trace.
      logAuth('persist-error', e instanceof Error ? e.message : String(e));
    }
  },

  clearSession: async opts => {
    if (opts?.reason === 'expired') logAuth('logout', 'session expired/revoked');
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_TOKEN),
      SecureStore.deleteItemAsync(KEY_REFRESH),
      SecureStore.deleteItemAsync(KEY_EXPIRES),
      SecureStore.deleteItemAsync(KEY_USER_SUB),
      SecureStore.deleteItemAsync(KEY_USER_NAME),
    ]);
    set({ token: null, refreshToken: null, expiresAt: null, user: null });
    Sentry.setUser(null);
  },

  refreshIfNeeded: async opts => {
    const { token, refreshToken, expiresAt, user } = get();
    if (!token) return null;
    const force = opts?.force ?? false;
    // A forced caller reports the token its 401'd request actually sent; if the session has
    // already moved past it (another caller refreshed in the meantime), hand back the current
    // token instead of rotating again — every extra rotation risks tripping reuse detection.
    if (force && opts?.sentToken && opts.sentToken !== token) return token;
    const fresh = expiresAt ? Date.now() < expiresAt - 60_000 : false;
    // Proactive callers stand pat while the token is still fresh; a forced (post-401) caller
    // always attempts a refresh.
    if (!force && fresh) return token;
    if (!refreshToken || !user) {
      // No way to refresh. A forced caller reached here because the server already rejected the
      // token (401), so the session is definitively dead — clear it for re-auth. A proactive
      // caller keeps the (possibly still-valid) token and lets any later 401 trigger the force path.
      if (force) {
        await get().clearSession({ reason: 'expired' });
        return null;
      }
      return token;
    }
    // Coalesce concurrent refreshes: the first caller owns the request; the rest await it.
    if (refreshing) return refreshing;
    refreshing = (async (): Promise<string | null> => {
      try {
        const t = await refreshTokens(refreshToken);
        if (!t.accessToken) return token;
        const next: Session = {
          accessToken: t.accessToken,
          refreshToken: t.refreshToken ?? refreshToken,
          expiresAt: Date.now() + (t.expiresIn ?? 3600) * 1000,
        };
        await get().setSession(next, user);
        return next.accessToken;
      } catch (e) {
        // Definitive rejection (refresh token/client invalid) — drop the session to re-auth.
        if (e instanceof RefreshError && e.definitive) {
          Sentry.captureMessage(`auth: definitive refresh failure — ${e.message}`, 'warning');
          await get().clearSession({ reason: 'expired' });
          return null;
        }
        // Transient (network/timeout/5xx): keep the session and return the current token
        // best-effort — a blip must not log the user out; the next 401 retries.
        logAuth('refresh:transient', e instanceof Error ? e.message : String(e));
        return token;
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  },

  isAuthenticated: () => !!get().token && !!get().user,
}));
