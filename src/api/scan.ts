import { File } from 'expo-file-system';
import { Sentry } from '../observability/breadcrumb';
import { createScan as rawPostScans } from './generated/scans/scans';
import type { ScanResponse } from './generated/models';

/** `POST /scans` of a local JPEG, wrapped in a Sentry span. */
export function scanCard(uri: string): Promise<ScanResponse> {
  return Sentry.startSpan(
    {
      name: 'POST /scans',
      op: 'http.client',
      attributes: {
        'http.method': 'POST',
        'http.route': '/scans',
        'mime.type': 'image/jpeg',
      },
    },
    // The generated client builds the multipart body itself; expo/fetch encodes a `File` part natively.
    () => rawPostScans({ image: new File(uri) }),
  );
}
