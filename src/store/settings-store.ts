import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEY_API_URL = 'lupira.apiUrl';
const KEY_API_KEY = 'lupira.apiKey';
const KEY_VOICE = 'lupira.voice';
const KEY_SPEED = 'lupira.speed';

const DEFAULT_API_URL = 'wss://tts.lupira.com/tts/stream';
const DEFAULT_VOICE = 'af_heart';
const DEFAULT_SPEED = 1.0;

type Settings = {
  apiUrl: string;
  apiKey: string;
  voice: string;
  speed: number;
  loaded: boolean;
};

type Actions = {
  load: () => Promise<void>;
  setCredentials: (apiUrl: string, apiKey: string) => Promise<void>;
  setVoice: (voice: string) => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  hasCredentials: () => boolean;
};

export const useSettings = create<Settings & Actions>((set, get) => ({
  apiUrl: DEFAULT_API_URL,
  apiKey: '',
  voice: DEFAULT_VOICE,
  speed: DEFAULT_SPEED,
  loaded: false,

  load: async () => {
    const [apiUrl, apiKey, voice, speedRaw] = await Promise.all([
      SecureStore.getItemAsync(KEY_API_URL),
      SecureStore.getItemAsync(KEY_API_KEY),
      SecureStore.getItemAsync(KEY_VOICE),
      SecureStore.getItemAsync(KEY_SPEED),
    ]);
    const speed = speedRaw ? Number(speedRaw) : DEFAULT_SPEED;
    set({
      apiUrl: apiUrl || DEFAULT_API_URL,
      apiKey: apiKey || '',
      voice: voice || DEFAULT_VOICE,
      speed: Number.isFinite(speed) ? speed : DEFAULT_SPEED,
      loaded: true,
    });
  },

  setCredentials: async (apiUrl, apiKey) => {
    await Promise.all([
      SecureStore.setItemAsync(KEY_API_URL, apiUrl),
      SecureStore.setItemAsync(KEY_API_KEY, apiKey),
    ]);
    set({ apiUrl, apiKey });
  },

  setVoice: async (voice) => {
    await SecureStore.setItemAsync(KEY_VOICE, voice);
    set({ voice });
  },

  setSpeed: async (speed) => {
    await SecureStore.setItemAsync(KEY_SPEED, String(speed));
    set({ speed });
  },

  hasCredentials: () => {
    const s = get();
    return s.apiUrl.length > 0 && s.apiKey.length > 0;
  },
}));
