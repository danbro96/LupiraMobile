export const DEFAULT_API_URL = 'wss://tts.lupira.com/tts/stream';
export const DEFAULT_VOICE = 'af_heart';
export const DEFAULT_SPEED = 1.0;
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2.0;

export const FLUSH_DEBOUNCE_MS = 250;
export const SENTENCE_TERMINATORS = /[.!?]\s*$/;

export function optionsUrlFromWs(wsUrl: string): string {
  let httpUrl = wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  httpUrl = httpUrl.replace(/\/tts\/stream(\?.*)?$/, '/options');
  return httpUrl;
}
