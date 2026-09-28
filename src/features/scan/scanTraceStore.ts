import { create } from 'zustand';
import { breadcrumb, type BreadcrumbCategory } from '../../observability/breadcrumb';

/**
 * Pipeline stage of a trace event. `camera`/`worklet` are session-level; the rest belong to one capture and
 * carry its `captureId`, so a single card's fire → crop → upload → result chain can be filtered out.
 */
export type ScanTraceKind =
  | 'camera'
  | 'worklet'
  | 'fire'
  | 'crop'
  | 'upload'
  | 'result'
  | 'add';

export type ScanTraceLevel = 'debug' | 'info' | 'warning' | 'error';

export type ScanTraceEvent = {
  seq: number;
  ts: number;
  kind: ScanTraceKind;
  level: ScanTraceLevel;
  message: string;
  captureId?: string;
  data?: Record<string, unknown>;
};

const MAX_TRACE_EVENTS = 400;

const BREADCRUMB_CATEGORY: Record<ScanTraceKind, BreadcrumbCategory> = {
  camera: 'camera',
  worklet: 'frame_processor',
  fire: 'capture',
  crop: 'crop',
  upload: 'upload',
  result: 'upload',
  add: 'selection',
};

type TraceState = {
  events: ScanTraceEvent[];
  clear: () => void;
};

let seq = 0;

export const useScanTrace = create<TraceState>((set) => ({
  events: [],
  clear: () => set({ events: [] }),
}));

/**
 * Record one pipeline event: in-memory ring buffer (debug log screen / Share), Sentry breadcrumb, and Metro
 * console in dev builds.
 */
export function traceScan(
  kind: ScanTraceKind,
  message: string,
  opts: { captureId?: string; data?: Record<string, unknown>; level?: ScanTraceLevel } = {},
): void {
  const level = opts.level ?? 'info';
  const event: ScanTraceEvent = {
    seq: ++seq,
    ts: Date.now(),
    kind,
    level,
    message,
    captureId: opts.captureId,
    data: opts.data,
  };
  useScanTrace.setState((s) => ({
    events: s.events.length >= MAX_TRACE_EVENTS
      ? [...s.events.slice(s.events.length - MAX_TRACE_EVENTS + 1), event]
      : [...s.events, event],
  }));
  breadcrumb(BREADCRUMB_CATEGORY[kind], message, { captureId: opts.captureId, ...opts.data }, level);
  // console.log only: warn/error would pop LogBox over the camera on every failed scan.
  if (__DEV__) {
    console.log(`[scan:${kind}:${level}]${opts.captureId ? ` ${opts.captureId}` : ''} ${message}`, opts.data ?? '');
  }
}
