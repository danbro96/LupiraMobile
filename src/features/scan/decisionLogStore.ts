import { create } from 'zustand';
import type { DetectionMetrics } from './detection/useCardDetection';
import { HARD_FLOORS } from './detection/useCardDetection';
import { SCAN_HYSTERESIS } from '../../store/scan-settings-store';

/**
 * Categorised reason for the *current* decision-policy state. The pill renders
 * one line per kind; the log screen renders the same kind + structured fields.
 *
 * Kept structured (vs a free-form string) so consumers can colour-code, sort,
 * or filter without re-parsing.
 */
export type DecisionReason =
  | { kind: 'no-quad' }
  | { kind: 'below-band'; composite: number; thresholdLow: number; thresholdHigh: number }
  | {
      kind: 'blocked-floor';
      floor: 'coverage' | 'stability' | 'sharpness' | 'brightness';
      value: number;
      threshold: number;
    }
  | { kind: 'cooldown'; msRemaining: number }
  | { kind: 'progressing'; stableFrames: number; minStableFrames: number }
  | { kind: 'fired'; quadCentroid: { x: number; y: number } };

export type DecisionLogEntry = {
  ts: number;
  reason: DecisionReason;
  composite: number;
  stability: number;
  sharpness: number;
  coverage: number;
  brightness: number;
  brightnessFit: number;
  inHysteresis: boolean;
  hardFloorPass: boolean;
  cooldownActive: boolean;
  detectionFps: number;
  framesProcessed: number;
};

const MAX_LOG_ENTRIES = 200;

type LogState = {
  entries: DecisionLogEntry[];
  /**
   * Mirror of the most recent reason, kept separately so the always-on status
   * pill can read it via a cheap selector without subscribing to the whole
   * `entries` array (which mutates frequently).
   */
  latest: DecisionLogEntry | null;
  append: (entry: DecisionLogEntry) => void;
  clear: () => void;
};

export const useDecisionLog = create<LogState>((set) => ({
  entries: [],
  latest: null,
  append: (entry) =>
    set((s) => {
      const next = s.entries.length >= MAX_LOG_ENTRIES
        ? [...s.entries.slice(s.entries.length - MAX_LOG_ENTRIES + 1), entry]
        : [...s.entries, entry];
      return { entries: next, latest: entry };
    }),
  clear: () => set({ entries: [], latest: null }),
}));

/**
 * Sample selector for the always-on status pill. Returns just the latest
 * entry — re-renders only when a new decision is appended (i.e. on a
 * transition), not on every internal-only change.
 */
export const selectLatestDecision = (s: LogState) => s.latest;

/**
 * Derive the structured `DecisionReason` from a metrics snapshot. JS-side
 * mirror of the worklet's gate logic — uses the exact same `HARD_FLOORS`
 * constants and hysteresis offsets, so the reason text always matches the
 * actual gate behaviour.
 *
 * `thresholdHigh` is `settings.captureThreshold`; `thresholdLow` is derived
 * the same way the worklet does it.
 */
export function deriveDecisionReason(
  m: DetectionMetrics,
  thresholdHigh: number,
): DecisionReason {
  if (!m.hasQuad) {
    return { kind: 'no-quad' };
  }
  // Identify the worst-failing hard floor (largest *relative* gap below).
  const failures: { floor: 'coverage' | 'stability' | 'sharpness' | 'brightness'; value: number; threshold: number; gap: number }[] = [];
  if (m.coverage < HARD_FLOORS.coverage) {
    failures.push({
      floor: 'coverage',
      value: m.coverage,
      threshold: HARD_FLOORS.coverage,
      gap: (HARD_FLOORS.coverage - m.coverage) / HARD_FLOORS.coverage,
    });
  }
  if (m.stability < HARD_FLOORS.stability) {
    failures.push({
      floor: 'stability',
      value: m.stability,
      threshold: HARD_FLOORS.stability,
      gap: (HARD_FLOORS.stability - m.stability) / HARD_FLOORS.stability,
    });
  }
  if (m.sharpness < HARD_FLOORS.sharpness) {
    failures.push({
      floor: 'sharpness',
      value: m.sharpness,
      threshold: HARD_FLOORS.sharpness,
      gap: (HARD_FLOORS.sharpness - m.sharpness) / HARD_FLOORS.sharpness,
    });
  }
  if (m.brightness < HARD_FLOORS.brightnessMin) {
    failures.push({
      floor: 'brightness',
      value: m.brightness,
      threshold: HARD_FLOORS.brightnessMin,
      gap: (HARD_FLOORS.brightnessMin - m.brightness) / HARD_FLOORS.brightnessMin,
    });
  } else if (m.brightness > HARD_FLOORS.brightnessMax) {
    failures.push({
      floor: 'brightness',
      value: m.brightness,
      threshold: HARD_FLOORS.brightnessMax,
      gap: (m.brightness - HARD_FLOORS.brightnessMax) / HARD_FLOORS.brightnessMax,
    });
  }
  if (failures.length > 0) {
    failures.sort((a, b) => b.gap - a.gap);
    const worst = failures[0];
    return {
      kind: 'blocked-floor',
      floor: worst.floor,
      value: worst.value,
      threshold: worst.threshold,
    };
  }
  if (m.cooldownActive) {
    return { kind: 'cooldown', msRemaining: m.cooldownRemainingMs };
  }
  if (!m.inHysteresis) {
    const thresholdLow = thresholdHigh - (SCAN_HYSTERESIS.HIGH - SCAN_HYSTERESIS.LOW);
    return { kind: 'below-band', composite: m.score, thresholdHigh, thresholdLow };
  }
  // In the band, hard floors clear, no cooldown — actively progressing.
  return { kind: 'progressing', stableFrames: 0, minStableFrames: 0 };
}

/**
 * Compose a `DecisionLogEntry` from a metrics snapshot + a derived reason.
 * Pure helper; safe to call from the JS-thread polling effect.
 */
export function buildLogEntry(
  m: DetectionMetrics,
  reason: DecisionReason,
): DecisionLogEntry {
  return {
    ts: Date.now(),
    reason,
    composite: m.score,
    stability: m.stability,
    sharpness: m.sharpness,
    coverage: m.coverage,
    brightness: m.brightness,
    brightnessFit: m.brightnessFit,
    inHysteresis: m.inHysteresis,
    hardFloorPass: m.hardFloorPass,
    cooldownActive: m.cooldownActive,
    detectionFps: m.detectionFps,
    framesProcessed: m.framesProcessed,
  };
}

/**
 * True if two `DecisionReason`s describe the same situation. Used to
 * de-duplicate consecutive identical entries — a long blocked-sharpness
 * stretch should appear as one entry, not 60.
 */
export function reasonsEqual(a: DecisionReason | undefined, b: DecisionReason): boolean {
  if (!a) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'blocked-floor' && b.kind === 'blocked-floor') {
    return a.floor === b.floor;
  }
  // For other kinds, kind alone is enough — the small numeric drift from
  // frame to frame doesn't constitute a meaningfully new state.
  return true;
}
