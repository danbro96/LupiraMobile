import type { ScanResponse } from '../../api/generated/models';

export type CaptureId = string;

/**
 * State machine for one capture record:
 *
 *   uploading → recognised
 *             ↘ error
 *
 * `recognised` may carry an `addedPrintingId` if the auto-add policy fired (high-confidence match) — the gallery
 * tile renders a green check vs an amber "needs review" prompt off that. `dismiss` removes a record (swipe-away).
 */
export type CaptureState =
  | { kind: 'uploading'; uri: string }
  | {
      kind: 'recognised';
      uri: string;
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
  | { type: 'capture/add'; id: CaptureId; createdAt: number; uri: string }
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
  | { type: 'capture/dismiss'; id: CaptureId };

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
    case 'capture/add':
      return [
        ...state,
        { id: action.id, createdAt: action.createdAt, state: { kind: 'uploading', uri: action.uri } },
      ];

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
          state: { kind: 'recognised', uri: r.state.uri, response: action.response },
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

    default:
      // Exhaustiveness check at compile time.
      return state;
  }
}

/** Sortable, unique-enough capture id without a crypto polyfill: `cap-<ms>-<rand>`. */
export function newCaptureId(): CaptureId {
  return `cap-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
