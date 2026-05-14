import { useMutation } from '@tanstack/react-query';
import { Sentry } from '../observability/breadcrumb';
import { postScans as rawPostScans } from './generated/scans/scans';
import type { ScanResponse } from './generated/models';

/**
 * Convenience input shape for callers — same as the old `mtgApi.scanCard`
 * argument so `ScanScreen` can keep its mental model. The hook builds the
 * multipart FormData itself, mirroring React Native's `{uri, type, name}`
 * blob descriptor that the generated `usePostScans` doesn't know about.
 */
export type ScanInput = {
  uri: string;
  mimeType?: string;
  fileName?: string;
};

function buildScanFormData(input: ScanInput): FormData {
  const form = new FormData();
  // RN FormData accepts a `{uri, type, name}` descriptor that the bridge
  // turns into a multipart file part. TS doesn't model that — cast.
  form.append('image', {
    uri: input.uri,
    type: input.mimeType ?? 'image/jpeg',
    name: input.fileName ?? 'scan.jpg',
  } as unknown as Blob);
  return form;
}

/**
 * `POST /scans` instrumented with a Sentry span — preserves the only network
 * span we had on the hand-typed client. Wraps the generated `postScans`
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
 * record). Same Sentry span as the hook variant. Returns the unwrapped
 * `ScanResponse` body — callers don't need the envelope.
 */
export async function scanCard(input: ScanInput): Promise<ScanResponse> {
  const envelope = await Sentry.startSpan(
    {
      name: 'POST /scans',
      op: 'http.client',
      attributes: {
        'http.method': 'POST',
        'http.route': '/scans',
        'mime.type': input.mimeType ?? 'image/jpeg',
      },
    },
    () => rawPostScans({ image: buildScanFormData(input) as unknown as Blob }),
  );
  // The envelope union also encodes 400 (ProblemDetails); the mutator throws
  // on non-2xx so in practice we only see the 200 branch — narrow.
  return envelope.data as ScanResponse;
}
