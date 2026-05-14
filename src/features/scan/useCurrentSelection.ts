import { useEffect } from 'react';
import { useSelection } from '../../store/selection-store';
import {
  getSelectionsSelectionId,
  postSelections,
} from '../../api/generated/selections/selections';
import type { SelectionResponse } from '../../api/generated/models';
import { ApiError } from '../../api/mutator';

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
        const envelope = await getSelectionsSelectionId(currentSelectionId);
        // Mutator throws on non-2xx — 200 branch is the only one reachable.
        return (envelope.data as SelectionResponse).id;
      } catch (e: unknown) {
        if (e instanceof ApiError && e.status === 404) {
          await setCurrent(null);
        } else {
          throw e;
        }
      }
    }

    const created = await postSelections();
    const id = (created.data as SelectionResponse).id;
    await setCurrent(id);
    return id;
  }

  async function reset(): Promise<void> {
    await setCurrent(null);
  }

  return { currentSelectionId, ensure, reset };
}
