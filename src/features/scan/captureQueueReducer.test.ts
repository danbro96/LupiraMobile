import { describe, expect, it } from 'vitest';
import type { ScanResponse } from '../../api/generated/models';
import { captureQueueReducer, needsReview, type CaptureRecord } from './captureQueueReducer';

const response = { scanId: 's', confidence: 'Medium', candidates: [] } as unknown as ScanResponse;

function uploading(): CaptureRecord[] {
  return captureQueueReducer([], { type: 'capture/add', id: 'a', createdAt: 1, uri: 'file://a.jpg' });
}

describe('captureQueueReducer', () => {
  it('needs review once recognised, not after a match is added', () => {
    const recognised = captureQueueReducer(uploading(), { type: 'capture/recognised', id: 'a', response });
    expect(needsReview(recognised[0])).toBe(true);
    const added = captureQueueReducer(recognised, {
      type: 'capture/added',
      id: 'a',
      added: { printingId: 'p', instanceId: 'i' },
    });
    expect(needsReview(added[0])).toBe(false);
  });

  it('retries a failed capture that still has its image', () => {
    const failed = captureQueueReducer(uploading(), { type: 'capture/error', id: 'a', message: 'timeout' });
    const retried = captureQueueReducer(failed, { type: 'capture/retry', id: 'a' });
    expect(retried[0].state).toEqual({ kind: 'uploading', uri: 'file://a.jpg' });
  });

  it('drops a late recognise for a record no longer uploading', () => {
    const failed = captureQueueReducer(uploading(), { type: 'capture/error', id: 'a', message: 'x' });
    const late = captureQueueReducer(failed, { type: 'capture/recognised', id: 'a', response });
    expect(late[0].state.kind).toBe('error');
  });
});
