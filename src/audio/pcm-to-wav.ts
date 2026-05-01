const SAMPLE_RATE = 24000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const HEADER_SIZE = 44;

export function pcmToWav(pcm: ArrayBuffer): ArrayBuffer {
  const out = new ArrayBuffer(HEADER_SIZE + pcm.byteLength);
  const view = new DataView(out);
  const byteRate = (SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);

  new Uint8Array(out, HEADER_SIZE).set(new Uint8Array(pcm));
  return out;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binary);
  return Buffer.from(binary, 'binary').toString('base64');
}

function writeAscii(view: DataView, offset: number, ascii: string): void {
  for (let i = 0; i < ascii.length; i++) view.setUint8(offset + i, ascii.charCodeAt(i));
}
