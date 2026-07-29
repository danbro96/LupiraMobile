import type { ScanResponse } from '../../api/generated/models';

export type CaptureId = string;

/**
 * State machine for one capture record:
 *
 *   capturing → uploading → recognised
 *                        ↘ error
 *
 * `recognised` may carry an `addedPrintingId` if the auto-add policy fired (high-confidence match) — the gallery
 * tile renders a green check vs an amber "needs review" prompt off that. `dismiss` removes a record (swipe-away).
 */
export type CaptureState =
  | { kind: 'capturing' }
  | { kind: 'uploading'; uri: string; sourceWidth: number; sourceHeight: number }
  | {
      kind: 'recognised';
      uri: string;
      sourceWidth: number;
      sourceHeight: number;
      response: ScanResponse;
      /** Set when the high-confidence auto-add policy fired for this capture. */
      addedPrintingId?: string;
    }
  | { kind: 'error'; uri?: string; message: string };

export type CaptureRecord = {
  id: CaptureId;
  /** Wall-clock ms when the capture started — used for stable ordering. */
  createdAt: number;
  state: CaptureState;
};

export type CaptureAction =
  | { type: 'capture/start'; id: CaptureId; createdAt: number }
  | {
      type: 'capture/uploading';
      id: CaptureId;
      uri: string;
      sourceWidth: number;
      sourceHeight: number;
    }
  | {
      type: 'capture/recognised';
      id: CaptureId;
      response: ScanResponse;
    }
  | {
      type: 'capture/auto-add';
      id: CaptureId;
      printingId: string;
    }
  | { type: 'capture/error'; id: CaptureId; message: string }
  | { type: 'capture/dismiss'; id: CaptureId }
  | { type: 'capture/clear-all' };

/**
 * Pure reducer for the scan capture queue; each action mutates a single record, looked up by id. Purity is
 * what keeps the screen from having to coordinate stale-closure updates between rapid auto-captures and
 * upload-completion callbacks: concurrency safety lives entirely here, and `ScanScreen`'s orchestration is
 * fire-and-forget.
 */
export function captureQueueReducer(
  state: CaptureRecord[],
  action: CaptureAction,
): CaptureRecord[] {
  switch (action.type) {
    case 'capture/start':
      return [
        ...state,
        { id: action.id, createdAt: action.createdAt, state: { kind: 'capturing' } },
      ];

    case 'capture/uploading':
      return state.map((r) =>
        r.id === action.id
          ? {
              ...r,
              state: {
                kind: 'uploading',
                uri: action.uri,
                sourceWidth: action.sourceWidth,
                sourceHeight: action.sourceHeight,
              },
            }
          : r,
      );

    case 'capture/recognised':
      return state.map((r) => {
        if (r.id !== action.id) return r;
        if (r.state.kind !== 'uploading') {
          // Got a recognise event for a record that isn't in 'uploading' —
          // most likely a late callback after the user dismissed it. Drop.
          return r;
        }
        return {
          ...r,
          state: {
            kind: 'recognised',
            uri: r.state.uri,
            sourceWidth: r.state.sourceWidth,
            sourceHeight: r.state.sourceHeight,
            response: action.response,
          },
        };
      });

    case 'capture/auto-add':
      return state.map((r) => {
        if (r.id !== action.id) return r;
        if (r.state.kind !== 'recognised') return r;
        return {
          ...r,
          state: { ...r.state, addedPrintingId: action.printingId },
        };
      });

    case 'capture/error':
      return state.map((r) => {
        if (r.id !== action.id) return r;
        const uri =
          r.state.kind === 'uploading' || r.state.kind === 'recognised'
            ? r.state.uri
            : undefined;
        return { ...r, state: { kind: 'error', uri, message: action.message } };
      });

    case 'capture/dismiss':
      return state.filter((r) => r.id !== action.id);

    case 'capture/clear-all':
      return [];

    default:
      // Exhaustiveness check at compile time.
      return state;
  }
}

/**
 * Generate a sortable, unique capture id without depending on a crypto polyfill.
 * Format: `cap-<ms>-<rand>`. Collision-resistant for the gallery's use case
 * (single device, captures spaced by at least the focusTo/cropToQuad cycle).
 */
export function newCaptureId(): CaptureId {
  return `cap-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
