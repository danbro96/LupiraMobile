import { useEffect } from 'react';
import { useSelection } from '../../store/selection-store';
import { mtgApi } from '../../api/mtg-client';
import { ApiError } from '../../api/mtg-client';

/**
 * Returns the current selection id, lazily creating one when missing or expired.
 * Server returns 404 for expired selections — that branch clears state and creates a new one.
 */
export function useCurrentSelection() {
  const loaded = useSelection(s => s.loaded);
  const currentSelectionId = useSelection(s => s.currentSelectionId);
  const load = useSelection(s => s.load);
  const setCurrent = useSelection(s => s.setCurrent);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  async function ensure(): Promise<string> {
    if (currentSelectionId) {
      try {
        const fresh = await mtgApi.selections.get(currentSelectionId);
        return fresh.id;
      } catch (e: unknown) {
        if (e instanceof ApiError && e.status === 404) {
          await setCurrent(null);
        } else {
          throw e;
        }
      }
    }

    const created = await mtgApi.selections.create();
    await setCurrent(created.id);
    return created.id;
  }

  async function reset(): Promise<void> {
    await setCurrent(null);
  }

  return { currentSelectionId, ensure, reset };
}
