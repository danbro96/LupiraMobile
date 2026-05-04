import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEY_CURRENT_SELECTION = 'lupira.mtg.currentSelectionId';

type SelectionState = {
  loaded: boolean;
  currentSelectionId: string | null;
};

type SelectionActions = {
  load: () => Promise<void>;
  setCurrent: (selectionId: string | null) => Promise<void>;
};

export const useSelection = create<SelectionState & SelectionActions>(set => ({
  loaded: false,
  currentSelectionId: null,

  load: async () => {
    const id = await SecureStore.getItemAsync(KEY_CURRENT_SELECTION);
    set({ loaded: true, currentSelectionId: id ?? null });
  },

  setCurrent: async selectionId => {
    if (selectionId) {
      await SecureStore.setItemAsync(KEY_CURRENT_SELECTION, selectionId);
    } else {
      await SecureStore.deleteItemAsync(KEY_CURRENT_SELECTION);
    }

    set({ currentSelectionId: selectionId });
  },
}));
