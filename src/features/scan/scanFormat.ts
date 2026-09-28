import type { Palette } from '../../ui/theme';
import type { DecisionReason } from './decisionLogStore';

/** Brightness is 0..255, every other signal 0..1 — precision follows magnitude. */
export function fmtSignal(n: number): string {
  if (Math.abs(n) >= 10) return Math.round(n).toString();
  return n.toFixed(2);
}

export function fmtScore(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

export function reasonTint(reason: DecisionReason, c: Palette): string {
  switch (reason.kind) {
    case 'no-quad':
      return reason.clipped ? c.warning : c.textSubtle;
    case 'blocked-floor':
    case 'cooldown':
      return c.warning;
    case 'below-band':
      return c.text;
    case 'progressing':
    case 'fired':
      return c.success;
  }
}
