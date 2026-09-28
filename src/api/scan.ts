import { useMutation } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import { Sentry } from '../observability/breadcrumb';
import { createScan as rawPostScans } from './generated/scans/scans';
import type { ScanResponse } from './generated/models';

/** Local JPEG to upload; `mimeType`/`fileName` are recorded on the span only — the `File` carries its own. */
export type ScanInput = {
  uri: string;
  mimeType?: string;
  fileName?: string;
};

/**
 * `POST /scans` instrumented with a Sentry span — preserves the only network
 * span we had on the hand-typed client. Wraps the generated `createScan`
 * imperative function in a fresh `useMutation` so the variables type is
 * `ScanInput` (not the generated `PostScansBody = { image: Blob }`),
 * matching the existing `ScanScreen` call sites byte-for-byte.
 */
export function usePostScansWithSpan() {
  return useMutation<ScanResponse, Error, ScanInput>({
    mutationFn: (input) => scanCard(input),
  });
}

/**
 * Imperative `POST /scans` for fire-and-forget call sites (e.g. the gallery's
 * streaming-capture path that doesn't want to bind a mutation hook per
 * record). Same Sentry span as the hook variant.
 */
export function scanCard(input: ScanInput): Promise<ScanResponse> {
  return Sentry.startSpan(
    {
      name: 'POST /scans',
      op: 'http.client',
      attributes: {
        'http.method': 'POST',
        'http.route': '/scans',
        'mime.type': input.mimeType ?? 'image/jpeg',
      },
    },
    // The generated client builds the multipart body itself; expo/fetch encodes a `File` part natively.
    () => rawPostScans({ image: new File(input.uri) }),
  );
}
