import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEY_AUTO = 'lupira.scan.autoCapture';
const KEY_THRESHOLD = 'lupira.scan.captureThreshold';
const KEY_MIN_FRAMES = 'lupira.scan.minStableFrames';
const KEY_W_STABILITY = 'lupira.scan.wStability.v3';
const KEY_W_SHARPNESS = 'lupira.scan.wSharpness.v3';
const KEY_W_COVERAGE = 'lupira.scan.wCoverage.v3';
const KEY_W_BRIGHTNESS = 'lupira.scan.wBrightness.v3';
const KEY_DEBUG = 'lupira.scan.debugOverlay';

const DEFAULT_AUTO = true;
const DEFAULT_THRESHOLD = 0.78;
const DEFAULT_MIN_FRAMES = 4;
const DEFAULT_W_STABILITY = 0.35;
const DEFAULT_W_SHARPNESS = 0.3;
const DEFAULT_W_COVERAGE = 0.25;
const DEFAULT_W_BRIGHTNESS = 0.1;
const DEFAULT_DEBUG = false;

export const SCAN_THRESHOLD_BOUNDS = { min: 0.3, max: 0.95 } as const;
export const SCAN_MIN_FRAMES_BOUNDS = { min: 2, max: 16 } as const;

/**
 * Trigger-policy constants used by the worklet.
 *
 * - HYSTERESIS_BAND: the score enters the band at `captureThreshold` and only leaves below `captureThreshold - band`
 * - COOLDOWN_MS: after a capture, reject re-fires whose centroid is within `0.4 × shortEdge` for this long
 */
export const SCAN_HYSTERESIS_BAND = 0.12;
export const SCAN_COOLDOWN_MS = 1500;
export const SCAN_COOLDOWN_CENTROID_FRACTION = 0.4;

export type ScanWeights = {
  weightStability: number;
  weightSharpness: number;
  weightCoverage: number;
  weightBrightness: number;
};

type ScanSettings = ScanWeights & {
  autoCaptureEnabled: boolean;
  captureThreshold: number;
  minStableFrames: number;
  showDebugOverlay: boolean;
  loaded: boolean;
};

type Actions = {
  load: () => Promise<void>;
  setAutoCaptureEnabled: (v: boolean) => Promise<void>;
  setCaptureThreshold: (v: number) => Promise<void>;
  setMinStableFrames: (v: number) => Promise<void>;
  setWeights: (weights: Partial<ScanWeights>) => Promise<void>;
  setShowDebugOverlay: (v: boolean) => Promise<void>;
  resetToDefaults: () => Promise<void>;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  return raw === '1' || raw === 'true';
}

function parseNum(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const useScanSettings = create<ScanSettings & Actions>((set, get) => ({
  autoCaptureEnabled: DEFAULT_AUTO,
  captureThreshold: DEFAULT_THRESHOLD,
  minStableFrames: DEFAULT_MIN_FRAMES,
  weightStability: DEFAULT_W_STABILITY,
  weightSharpness: DEFAULT_W_SHARPNESS,
  weightCoverage: DEFAULT_W_COVERAGE,
  weightBrightness: DEFAULT_W_BRIGHTNESS,
  showDebugOverlay: DEFAULT_DEBUG,
  loaded: false,

  load: async () => {
    const [auto, thr, frames, ws, wsh, wc, wb, dbg] = await Promise.all([
      SecureStore.getItemAsync(KEY_AUTO),
      SecureStore.getItemAsync(KEY_THRESHOLD),
      SecureStore.getItemAsync(KEY_MIN_FRAMES),
      SecureStore.getItemAsync(KEY_W_STABILITY),
      SecureStore.getItemAsync(KEY_W_SHARPNESS),
      SecureStore.getItemAsync(KEY_W_COVERAGE),
      SecureStore.getItemAsync(KEY_W_BRIGHTNESS),
      SecureStore.getItemAsync(KEY_DEBUG),
    ]);
    set({
      autoCaptureEnabled: parseBool(auto, DEFAULT_AUTO),
      captureThreshold: clamp(parseNum(thr, DEFAULT_THRESHOLD), SCAN_THRESHOLD_BOUNDS.min, SCAN_THRESHOLD_BOUNDS.max),
      minStableFrames: Math.round(clamp(parseNum(frames, DEFAULT_MIN_FRAMES), SCAN_MIN_FRAMES_BOUNDS.min, SCAN_MIN_FRAMES_BOUNDS.max)),
      weightStability: clamp(parseNum(ws, DEFAULT_W_STABILITY), 0, 1),
      weightSharpness: clamp(parseNum(wsh, DEFAULT_W_SHARPNESS), 0, 1),
      weightCoverage: clamp(parseNum(wc, DEFAULT_W_COVERAGE), 0, 1),
      weightBrightness: clamp(parseNum(wb, DEFAULT_W_BRIGHTNESS), 0, 1),
      showDebugOverlay: parseBool(dbg, DEFAULT_DEBUG),
      loaded: true,
    });
  },

  setAutoCaptureEnabled: async (v) => {
    await SecureStore.setItemAsync(KEY_AUTO, v ? '1' : '0');
    set({ autoCaptureEnabled: v });
  },

  setCaptureThreshold: async (v) => {
    const clamped = clamp(v, SCAN_THRESHOLD_BOUNDS.min, SCAN_THRESHOLD_BOUNDS.max);
    await SecureStore.setItemAsync(KEY_THRESHOLD, String(clamped));
    set({ captureThreshold: clamped });
  },

  setMinStableFrames: async (v) => {
    const clamped = Math.round(clamp(v, SCAN_MIN_FRAMES_BOUNDS.min, SCAN_MIN_FRAMES_BOUNDS.max));
    await SecureStore.setItemAsync(KEY_MIN_FRAMES, String(clamped));
    set({ minStableFrames: clamped });
  },

  setWeights: async (weights) => {
    const cur = get();
    const s = clamp(weights.weightStability ?? cur.weightStability, 0, 1);
    const sh = clamp(weights.weightSharpness ?? cur.weightSharpness, 0, 1);
    const c = clamp(weights.weightCoverage ?? cur.weightCoverage, 0, 1);
    const b = clamp(weights.weightBrightness ?? cur.weightBrightness, 0, 1);
    await Promise.all([
      SecureStore.setItemAsync(KEY_W_STABILITY, String(s)),
      SecureStore.setItemAsync(KEY_W_SHARPNESS, String(sh)),
      SecureStore.setItemAsync(KEY_W_COVERAGE, String(c)),
      SecureStore.setItemAsync(KEY_W_BRIGHTNESS, String(b)),
    ]);
    set({ weightStability: s, weightSharpness: sh, weightCoverage: c, weightBrightness: b });
  },

  setShowDebugOverlay: async (v) => {
    await SecureStore.setItemAsync(KEY_DEBUG, v ? '1' : '0');
    set({ showDebugOverlay: v });
  },

  resetToDefaults: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_AUTO),
      SecureStore.deleteItemAsync(KEY_THRESHOLD),
      SecureStore.deleteItemAsync(KEY_MIN_FRAMES),
      SecureStore.deleteItemAsync(KEY_W_STABILITY),
      SecureStore.deleteItemAsync(KEY_W_SHARPNESS),
      SecureStore.deleteItemAsync(KEY_W_COVERAGE),
      SecureStore.deleteItemAsync(KEY_W_BRIGHTNESS),
      SecureStore.deleteItemAsync(KEY_DEBUG),
    ]);
    set({
      autoCaptureEnabled: DEFAULT_AUTO,
      captureThreshold: DEFAULT_THRESHOLD,
      minStableFrames: DEFAULT_MIN_FRAMES,
      weightStability: DEFAULT_W_STABILITY,
      weightSharpness: DEFAULT_W_SHARPNESS,
      weightCoverage: DEFAULT_W_COVERAGE,
      weightBrightness: DEFAULT_W_BRIGHTNESS,
      showDebugOverlay: DEFAULT_DEBUG,
        });
  },
}));
