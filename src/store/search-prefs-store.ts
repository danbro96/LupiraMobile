import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEY_RECENT = 'lupira.search.recent';
const KEY_VIEW = 'lupira.search.viewMode';
const MAX_RECENT = 8;

export type SearchViewMode = 'list' | 'grid';

type SearchPrefsState = {
  loaded: boolean;
  recent: string[];
  viewMode: SearchViewMode;
  load: () => Promise<void>;
  addRecent: (query: string) => Promise<void>;
  removeRecent: (query: string) => Promise<void>;
  setViewMode: (mode: SearchViewMode) => Promise<void>;
};

function parseRecent(raw: string | null): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export const useSearchPrefs = create<SearchPrefsState>((set, get) => ({
  loaded: false,
  recent: [],
  viewMode: 'list',

  load: async () => {
    const [recent, view] = await Promise.all([
      SecureStore.getItemAsync(KEY_RECENT),
      SecureStore.getItemAsync(KEY_VIEW),
    ]);
    set({ loaded: true, recent: parseRecent(recent), viewMode: view === 'grid' ? 'grid' : 'list' });
  },

  addRecent: async query => {
    const q = query.trim();
    if (!q) return;
    const recent = [q, ...get().recent.filter(r => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
    set({ recent });
    await SecureStore.setItemAsync(KEY_RECENT, JSON.stringify(recent));
  },

  removeRecent: async query => {
    const recent = get().recent.filter(r => r !== query);
    set({ recent });
    await SecureStore.setItemAsync(KEY_RECENT, JSON.stringify(recent));
  },

  setViewMode: async viewMode => {
    set({ viewMode });
    await SecureStore.setItemAsync(KEY_VIEW, viewMode);
  },
}));
