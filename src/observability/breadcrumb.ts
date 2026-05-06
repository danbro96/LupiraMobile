import * as Sentry from '@sentry/react-native';

/**
 * Centralised breadcrumb categories. Keep these stable so Sentry's category
 * filter remains useful across releases.
 */
export type BreadcrumbCategory =
  | 'camera'
  | 'capture'
  | 'crop'
  | 'upload'
  | 'appstate'
  | 'frame_processor'
  | 'navigation'
  | 'auth'
  | 'selection';

type Level = 'debug' | 'info' | 'warning' | 'error';

/**
 * Thin wrapper around `Sentry.addBreadcrumb` that enforces consistent
 * categories and reasonable defaults. The breadcrumb buffer survives
 * native crashes — when the SDK uploads the crash report on next launch,
 * these breadcrumbs are attached to the issue.
 */
export function breadcrumb(
  category: BreadcrumbCategory,
  message: string,
  data?: Record<string, unknown>,
  level: Level = 'info',
): void {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Re-export the Sentry namespace so call-sites can reach for `captureException`
 * / `startSpan` / etc. without importing `@sentry/react-native` directly.
 */
export { Sentry };
