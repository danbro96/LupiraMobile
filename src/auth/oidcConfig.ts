// Authentik OIDC client config for Lupira MTG (public PKCE client — no secret).
// The Authority/issuer + client id must match the Authentik `lupira-mtg` application/provider
// (see DevOps/Websites/lupira-mtg-api/deployment.md).

// No trailing slash — expo-auth-session appends `/.well-known/...` verbatim and Authentik 404s the `//`.
export const OIDC_ISSUER = 'https://auth.lupira.com/application/o/lupira-mtg';

/** Public client id — also the token `aud` the API validates. */
export const OIDC_CLIENT_ID = 'lupira-mtg';

/** `groups` drives admin; `offline_access` requests a refresh token. */
export const OIDC_SCOPES = ['openid', 'email', 'profile', 'groups', 'offline_access'];

/** App scheme (app.json `scheme`) — the redirect URI is `<scheme>://...`. */
export const OIDC_SCHEME = 'lupiramtg';

/**
 * Redirect path. A bare `lupiramtg://` has an empty authority that gets normalized to
 * `lupiramtg:` on redirect, so expo-auth-session can't match the callback (→ 'dismiss').
 * A non-empty path keeps the URI stable: `lupiramtg://oauthredirect`.
 * NOTE: this exact URI must be registered as an allowed redirect URI on the Authentik provider.
 */
export const OIDC_REDIRECT_PATH = 'oauthredirect';
