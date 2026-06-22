import * as AuthSession from 'expo-auth-session';
import { OIDC_CLIENT_ID, OIDC_ISSUER } from './oidcConfig';
import { REQUEST_TIMEOUT_MS } from '../config';
import { logAuth } from './authDebug';

// Non-hook OIDC helpers (the interactive login itself lives in LoginScreen via
// expo-auth-session's useAuthRequest). Discovery is fetched once and cached.

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
}

/**
 * A refresh attempt failed. `definitive` = the refresh token / client was rejected by the
 * server (re-auth required); otherwise the failure is transient (network/timeout/5xx) and the
 * session should be kept and retried later. See refreshIfNeeded in store/auth-store.ts.
 */
export class RefreshError extends Error {
  definitive: boolean;
  constructor(definitive: boolean, message: string) {
    super(message);
    this.definitive = definitive;
    this.name = 'RefreshError';
  }
}

/**
 * POST an `application/x-www-form-urlencoded` body to a token endpoint with a bounded timeout.
 * Returns the raw `{ status, text }` for any HTTP response (so callers branch on status);
 * throws only on a transport failure (network down / timeout / connection dropped mid-body).
 */
async function postForm(endpoint: string, params: Record<string, string>): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exchange an authorization code for tokens with a manual fetch (PKCE public client) so the
 * raw HTTP status + body are visible in the auth trace — expo-auth-session's exchangeCodeAsync
 * hides them and surfaces only "JSON Parse error" when the token endpoint returns a non-JSON
 * or empty body.
 */
export async function exchangeAuthCode(params: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<TokenSet> {
  const form: Record<string, string> = {
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: OIDC_CLIENT_ID,
  };
  if (params.codeVerifier) form.code_verifier = params.codeVerifier;

  logAuth('token:post', params.tokenEndpoint);
  const { status, text } = await postForm(params.tokenEndpoint, form);
  logAuth('token:response', `status=${status} len=${text.length} body=${text.slice(0, 400)}`);
  if (status < 200 || status >= 300) throw new Error(`token ${status}: ${text.slice(0, 400)}`);
  if (!text) throw new Error(`token ${status}: empty body`);

  const json = JSON.parse(text) as {
    access_token: string; refresh_token?: string; id_token?: string; expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresIn: json.expires_in,
  };
}

let discoveryPromise: Promise<AuthSession.DiscoveryDocument> | null = null;

export function getDiscovery(): Promise<AuthSession.DiscoveryDocument> {
  if (!discoveryPromise) {
    // Don't cache a failure: a single failed discovery (e.g. a launch-time network blip) must
    // not poison the cache for the whole session — null it out so the next call retries.
    discoveryPromise = AuthSession.fetchDiscoveryAsync(OIDC_ISSUER).catch(e => {
      discoveryPromise = null;
      throw e;
    });
  }
  return discoveryPromise;
}

/**
 * Exchange a refresh token for a fresh access token (+ rotated refresh token) via a manual POST
 * (mirrors exchangeAuthCode for full status visibility). Throws a RefreshError whose `definitive`
 * flag tells the caller whether to drop the session (grant rejected) or keep it and retry later
 * (transient network/server failure).
 */
export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  let discovery: AuthSession.DiscoveryDocument;
  try {
    discovery = await getDiscovery();
  } catch (e) {
    throw new RefreshError(false, `discovery: ${e instanceof Error ? e.message : String(e)}`);
  }
  const tokenEndpoint = discovery.tokenEndpoint;
  if (!tokenEndpoint) throw new RefreshError(false, 'discovery: no token endpoint');

  let status: number;
  let text: string;
  try {
    ({ status, text } = await postForm(tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OIDC_CLIENT_ID,
    }));
  } catch (e) {
    // Transport failure / timeout — transient, keep the session.
    throw new RefreshError(false, `network: ${e instanceof Error ? e.message : String(e)}`);
  }

  // On failure include a body slice — it carries the rejection reason (e.g. invalid_grant),
  // which is the difference between "token expired/revoked" and "rotation replay".
  const failBody = status < 200 || status >= 300 ? ` body=${text.slice(0, 200)}` : '';
  logAuth('refresh:response', `status=${status} len=${text.length}${failBody}`);
  // 400/401 = the refresh token or client was rejected → definitive, must re-authenticate.
  if (status === 400 || status === 401) throw new RefreshError(true, `refresh ${status}: ${text.slice(0, 200)}`);
  // 5xx / 429 / any other non-2xx → transient, retry on the next trigger.
  if (status < 200 || status >= 300) throw new RefreshError(false, `refresh ${status}`);
  if (!text) throw new RefreshError(false, 'refresh: empty body');

  const json = JSON.parse(text) as {
    access_token: string; refresh_token?: string; id_token?: string; expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresIn: json.expires_in,
  };
}

/** Decode a JWT payload (no signature check — the server verifies; this is for claims only). */
export function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) return {};
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
  try {
    const bytes = globalThis.atob(b64);
    const json = decodeURIComponent(
      Array.prototype.map.call(bytes, (c: string) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
