import { breadcrumb } from '../observability/breadcrumb';

/**
 * Trace one step of the OIDC flow as a Sentry `auth` breadcrumb. The buffer survives native
 * crashes and is attached to the next uploaded issue — so a sign-in that fails on a device we
 * can't reach still leaves a trail (discovery → request → prompt → exchange → setSession).
 * Never pass tokens or codes as `detail`; tags + booleans only.
 */
export function logAuth(tag: string, detail?: string): void {
  breadcrumb('auth', tag, detail ? { detail } : undefined);
}
