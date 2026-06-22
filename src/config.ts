// Lupira MTG defaults — overrideable from the in-app settings screen
// so dev builds can point at localhost without rebuilding.
export const DEFAULT_MTG_API_URL = 'https://mtg-api.lupira.com';

// Upper bound on a single network request (token exchange / refresh, API calls)
// before the AbortController fires.
export const REQUEST_TIMEOUT_MS = 15000;
