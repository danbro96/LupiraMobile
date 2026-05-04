import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_MTG_API_URL } from '../config';

const KEY_MTG_API_URL = 'lupira.mtg.apiUrl';
const KEY_TOKEN = 'lupira.mtg.deviceToken';
const KEY_USER_SUB = 'lupira.mtg.userSub';
const KEY_USER_NAME = 'lupira.mtg.userName';

export type AuthUser = {
  sub: string;
  displayName?: string;
};

type AuthState = {
  loaded: boolean;
  mtgApiUrl: string;
  token: string | null;
  user: AuthUser | null;
};

type AuthActions = {
  load: () => Promise<void>;
  setApiUrl: (mtgApiUrl: string) => Promise<void>;
  setSession: (token: string, user: AuthUser) => Promise<void>;
  clearSession: () => Promise<void>;
  isAuthenticated: () => boolean;
};

export const useAuth = create<AuthState & AuthActions>((set, get) => ({
  loaded: false,
  mtgApiUrl: DEFAULT_MTG_API_URL,
  token: null,
  user: null,

  load: async () => {
    const [mtgApiUrl, token, userSub, userName] = await Promise.all([
      SecureStore.getItemAsync(KEY_MTG_API_URL),
      SecureStore.getItemAsync(KEY_TOKEN),
      SecureStore.getItemAsync(KEY_USER_SUB),
      SecureStore.getItemAsync(KEY_USER_NAME),
    ]);

    const user: AuthUser | null = userSub
      ? { sub: userSub, displayName: userName ?? undefined }
      : null;

    set({
      loaded: true,
      mtgApiUrl: mtgApiUrl || DEFAULT_MTG_API_URL,
      token: token ?? null,
      user,
    });
  },

  setApiUrl: async mtgApiUrl => {
    await SecureStore.setItemAsync(KEY_MTG_API_URL, mtgApiUrl);
    set({ mtgApiUrl });
  },

  setSession: async (token, user) => {
    await Promise.all([
      SecureStore.setItemAsync(KEY_TOKEN, token),
      SecureStore.setItemAsync(KEY_USER_SUB, user.sub),
      user.displayName
        ? SecureStore.setItemAsync(KEY_USER_NAME, user.displayName)
        : SecureStore.deleteItemAsync(KEY_USER_NAME),
    ]);
    set({ token, user });
  },

  clearSession: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_TOKEN),
      SecureStore.deleteItemAsync(KEY_USER_SUB),
      SecureStore.deleteItemAsync(KEY_USER_NAME),
    ]);
    set({ token: null, user: null });
  },

  isAuthenticated: () => !!get().token && !!get().user,
}));
