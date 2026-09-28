import { create } from 'zustand';
import type { DetectionMetrics } from './detection/useCardDetection';
import { HARD_FLOORS } from './detection/useCardDetection';
import { SCAN_HYSTERESIS_BAND } from '../../store/scan-settings-store';
import { appendCapped } from './appendCapped';

/**
 * Categorised reason for the *current* decision-policy state. The pill renders one line per kind; the log
 * screen renders the same kind plus structured fields. Structured rather than a free-form string so
 * consumers can colour-code, sort or filter without re-parsing.
 */
type FloorName = 'coverage' | 'stability' | 'sharpness' | 'brightness';

export type DecisionReason =
  | { kind: 'no-quad'; clipped: boolean }
  | { kind: 'below-band'; composite: number; thresholdLow: number; thresholdHigh: number }
  | {
      kind: 'blocked-floor';
      floor: FloorName;
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
  /** Detector internals — explain `no-quad` (edges found but no contour passed the fill/aspect gates). */
  edgePixelCount: number;
  contourCount: number;
  largeContourCount: number;
  candidateQuadCount: number;
  clippedQuadCount: number;
  largestContourFillPct: number;
  largestContourAspect: number;
  lastStep: string;
  lastError: string;
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
    set((s) => ({ entries: appendCapped(s.entries, entry, MAX_LOG_ENTRIES), latest: entry })),
  clear: () => set({ entries: [], latest: null }),
}));

/**
 * Sample selector for the always-on status pill. Returns just the latest
 * entry — re-renders only when a new decision is appended (i.e. on a
 * transition), not on every internal-only change.
 */
export const selectLatestDecision = (s: LogState) => s.latest;

/**
 * Derive the structured `DecisionReason` from a metrics snapshot — the JS-side mirror of the worklet's gate
 * logic, using the same `HARD_FLOORS` constants and hysteresis offsets so the reason text always matches
 * actual gate behaviour. `thresholdHigh` is `settings.captureThreshold`; `thresholdLow` is derived the way
 * the worklet derives it.
 */
export function deriveDecisionReason(
  m: DetectionMetrics,
  thresholdHigh: number,
  stableFrames: number,
  minStableFrames: number,
): DecisionReason {
  if (!m.hasQuad) {
    return { kind: 'no-quad', clipped: m.clippedQuadCount > 0 };
  }
  // Report the worst-failing hard floor (largest *relative* gap below it).
  const tooBright = m.brightness > HARD_FLOORS.brightnessMax;
  const brightnessThreshold = tooBright ? HARD_FLOORS.brightnessMax : HARD_FLOORS.brightnessMin;
  const floors: [FloorName, number, number, number][] = [
    ['coverage', m.coverage, HARD_FLOORS.coverage, HARD_FLOORS.coverage - m.coverage],
    ['stability', m.stability, HARD_FLOORS.stability, HARD_FLOORS.stability - m.stability],
    ['sharpness', m.sharpness, HARD_FLOORS.sharpness, HARD_FLOORS.sharpness - m.sharpness],
    ['brightness', m.brightness, brightnessThreshold, tooBright ? m.brightness - brightnessThreshold : brightnessThreshold - m.brightness],
  ];
  let worst: { floor: FloorName; value: number; threshold: number; gap: number } | null = null;
  for (const [floor, value, threshold, shortfall] of floors) {
    const gap = shortfall / threshold;
    if (shortfall > 0 && (!worst || gap > worst.gap)) worst = { floor, value, threshold, gap };
  }
  if (worst) {
    return { kind: 'blocked-floor', floor: worst.floor, value: worst.value, threshold: worst.threshold };
  }
  if (m.cooldownActive) {
    return { kind: 'cooldown', msRemaining: m.cooldownRemainingMs };
  }
  if (!m.inHysteresis) {
    const thresholdLow = thresholdHigh - SCAN_HYSTERESIS_BAND;
    return { kind: 'below-band', composite: m.score, thresholdHigh, thresholdLow };
  }
  // In the band, hard floors clear, no cooldown — actively progressing.
  return { kind: 'progressing', stableFrames, minStableFrames };
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
    edgePixelCount: m.edgePixelCount,
    contourCount: m.contourCount,
    largeContourCount: m.largeContourCount,
    candidateQuadCount: m.candidateQuadCount,
    clippedQuadCount: m.clippedQuadCount,
    largestContourFillPct: m.largestContourFillPct,
    largestContourAspect: m.largestContourAspect,
    lastStep: m.lastStep,
    lastError: m.lastError,
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
  if (a.kind === 'no-quad' && b.kind === 'no-quad') {
    return a.clipped === b.clipped;
  }
  // For other kinds, kind alone is enough — the small numeric drift from
  // frame to frame doesn't constitute a meaningfully new state.
  return true;
}
