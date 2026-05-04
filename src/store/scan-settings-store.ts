import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEY_AUTO = 'lupira.scan.autoCapture';
const KEY_THRESHOLD = 'lupira.scan.captureThreshold';
const KEY_MIN_FRAMES = 'lupira.scan.minStableFrames';
const KEY_W_STABILITY = 'lupira.scan.wStability';
const KEY_W_SHARPNESS = 'lupira.scan.wSharpness';
const KEY_W_COVERAGE = 'lupira.scan.wCoverage';
const KEY_DEBUG = 'lupira.scan.debugOverlay';
const KEY_QUALITY = 'lupira.scan.jpegQuality';

const DEFAULT_AUTO = true;
const DEFAULT_THRESHOLD = 0.75;
const DEFAULT_MIN_FRAMES = 8;
const DEFAULT_W_STABILITY = 0.5;
const DEFAULT_W_SHARPNESS = 0.3;
const DEFAULT_W_COVERAGE = 0.2;
const DEFAULT_DEBUG = false;
const DEFAULT_QUALITY = 80;

export const SCAN_THRESHOLD_BOUNDS = { min: 0.3, max: 0.95 } as const;
export const SCAN_MIN_FRAMES_BOUNDS = { min: 4, max: 16 } as const;
export const SCAN_QUALITY_BOUNDS = { min: 60, max: 95 } as const;

type ScanSettings = {
  autoCaptureEnabled: boolean;
  captureThreshold: number;
  minStableFrames: number;
  weightStability: number;
  weightSharpness: number;
  weightCoverage: number;
  showDebugOverlay: boolean;
  jpegQuality: number;
  loaded: boolean;
};

type Actions = {
  load: () => Promise<void>;
  setAutoCaptureEnabled: (v: boolean) => Promise<void>;
  setCaptureThreshold: (v: number) => Promise<void>;
  setMinStableFrames: (v: number) => Promise<void>;
  setWeights: (stability: number, sharpness: number, coverage: number) => Promise<void>;
  setShowDebugOverlay: (v: boolean) => Promise<void>;
  setJpegQuality: (v: number) => Promise<void>;
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

export const useScanSettings = create<ScanSettings & Actions>((set) => ({
  autoCaptureEnabled: DEFAULT_AUTO,
  captureThreshold: DEFAULT_THRESHOLD,
  minStableFrames: DEFAULT_MIN_FRAMES,
  weightStability: DEFAULT_W_STABILITY,
  weightSharpness: DEFAULT_W_SHARPNESS,
  weightCoverage: DEFAULT_W_COVERAGE,
  showDebugOverlay: DEFAULT_DEBUG,
  jpegQuality: DEFAULT_QUALITY,
  loaded: false,

  load: async () => {
    const [auto, thr, frames, ws, wsh, wc, dbg, q] = await Promise.all([
      SecureStore.getItemAsync(KEY_AUTO),
      SecureStore.getItemAsync(KEY_THRESHOLD),
      SecureStore.getItemAsync(KEY_MIN_FRAMES),
      SecureStore.getItemAsync(KEY_W_STABILITY),
      SecureStore.getItemAsync(KEY_W_SHARPNESS),
      SecureStore.getItemAsync(KEY_W_COVERAGE),
      SecureStore.getItemAsync(KEY_DEBUG),
      SecureStore.getItemAsync(KEY_QUALITY),
    ]);
    set({
      autoCaptureEnabled: parseBool(auto, DEFAULT_AUTO),
      captureThreshold: clamp(parseNum(thr, DEFAULT_THRESHOLD), SCAN_THRESHOLD_BOUNDS.min, SCAN_THRESHOLD_BOUNDS.max),
      minStableFrames: Math.round(clamp(parseNum(frames, DEFAULT_MIN_FRAMES), SCAN_MIN_FRAMES_BOUNDS.min, SCAN_MIN_FRAMES_BOUNDS.max)),
      weightStability: clamp(parseNum(ws, DEFAULT_W_STABILITY), 0, 1),
      weightSharpness: clamp(parseNum(wsh, DEFAULT_W_SHARPNESS), 0, 1),
      weightCoverage: clamp(parseNum(wc, DEFAULT_W_COVERAGE), 0, 1),
      showDebugOverlay: parseBool(dbg, DEFAULT_DEBUG),
      jpegQuality: Math.round(clamp(parseNum(q, DEFAULT_QUALITY), SCAN_QUALITY_BOUNDS.min, SCAN_QUALITY_BOUNDS.max)),
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

  setWeights: async (stability, sharpness, coverage) => {
    const s = clamp(stability, 0, 1);
    const sh = clamp(sharpness, 0, 1);
    const c = clamp(coverage, 0, 1);
    await Promise.all([
      SecureStore.setItemAsync(KEY_W_STABILITY, String(s)),
      SecureStore.setItemAsync(KEY_W_SHARPNESS, String(sh)),
      SecureStore.setItemAsync(KEY_W_COVERAGE, String(c)),
    ]);
    set({ weightStability: s, weightSharpness: sh, weightCoverage: c });
  },

  setShowDebugOverlay: async (v) => {
    await SecureStore.setItemAsync(KEY_DEBUG, v ? '1' : '0');
    set({ showDebugOverlay: v });
  },

  setJpegQuality: async (v) => {
    const clamped = Math.round(clamp(v, SCAN_QUALITY_BOUNDS.min, SCAN_QUALITY_BOUNDS.max));
    await SecureStore.setItemAsync(KEY_QUALITY, String(clamped));
    set({ jpegQuality: clamped });
  },

  resetToDefaults: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_AUTO),
      SecureStore.deleteItemAsync(KEY_THRESHOLD),
      SecureStore.deleteItemAsync(KEY_MIN_FRAMES),
      SecureStore.deleteItemAsync(KEY_W_STABILITY),
      SecureStore.deleteItemAsync(KEY_W_SHARPNESS),
      SecureStore.deleteItemAsync(KEY_W_COVERAGE),
      SecureStore.deleteItemAsync(KEY_DEBUG),
      SecureStore.deleteItemAsync(KEY_QUALITY),
    ]);
    set({
      autoCaptureEnabled: DEFAULT_AUTO,
      captureThreshold: DEFAULT_THRESHOLD,
      minStableFrames: DEFAULT_MIN_FRAMES,
      weightStability: DEFAULT_W_STABILITY,
      weightSharpness: DEFAULT_W_SHARPNESS,
      weightCoverage: DEFAULT_W_COVERAGE,
      showDebugOverlay: DEFAULT_DEBUG,
      jpegQuality: DEFAULT_QUALITY,
    });
  },
}));
