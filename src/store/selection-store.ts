import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEY_CURRENT_SELECTION = 'lupira.mtg.currentSelectionId';
const KEY_LAST_COLLECTION = 'lupira.mtg.lastCollectionId';

type SelectionState = {
  loaded: boolean;
  currentSelectionId: string | null;
  /** Default commit target: the collection the last commit went to. */
  lastCollectionId: string | null;
};

type SelectionActions = {
  load: () => Promise<void>;
  setCurrent: (selectionId: string | null) => Promise<void>;
  setLastCollection: (collectionId: string | null) => Promise<void>;
};

export const useSelection = create<SelectionState & SelectionActions>(set => ({
  loaded: false,
  currentSelectionId: null,
  lastCollectionId: null,

  load: async () => {
    const [id, lastCollectionId] = await Promise.all([
      SecureStore.getItemAsync(KEY_CURRENT_SELECTION),
      SecureStore.getItemAsync(KEY_LAST_COLLECTION),
    ]);
    set({ loaded: true, currentSelectionId: id ?? null, lastCollectionId: lastCollectionId ?? null });
  },

  setCurrent: async selectionId => {
    await persist(KEY_CURRENT_SELECTION, selectionId);
    set({ currentSelectionId: selectionId });
  },

  setLastCollection: async collectionId => {
    await persist(KEY_LAST_COLLECTION, collectionId);
    set({ lastCollectionId: collectionId });
  },
}));

async function persist(key: string, value: string | null): Promise<void> {
  if (value) {
    await SecureStore.setItemAsync(key, value);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}
