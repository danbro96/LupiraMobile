import Constants from 'expo-constants';

// Lupira MTG defaults — overrideable from the in-app settings screen
// so dev builds can point at localhost without rebuilding.
export const DEFAULT_MTG_API_URL = 'https://mtg-api.lupira.com';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/** Public client key, safe to commit. */
export const SENTRY_DSN = 'https://dcb0e67aeb971bbec6f13deca66bea4c@o4511341575733248.ingest.de.sentry.io/4511341579862096';

// Upper bound on a single network request (token exchange / refresh, API calls)
// before the AbortController fires.
export const REQUEST_TIMEOUT_MS = 15000;
