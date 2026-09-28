import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSelection } from '../../store/selection-store';
import {
  getSelection,
  createSelection,
} from '../../api/generated/selections/selections';
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
        return (await getSelection(currentSelectionId)).id;
      } catch (e: unknown) {
        if (e instanceof ApiError && e.status === 404) {
          await setCurrent(null);
        } else {
          throw e;
        }
      }
    }

    const { id } = await createSelection();
    await setCurrent(id);
    return id;
  }

  return { currentSelectionId, ensure };
}

export function useCurrentSelectionQuery(currentSelectionId: string | null) {
  return useQuery({
    queryKey: ['selection', currentSelectionId],
    queryFn: () => getSelection(currentSelectionId!),
    enabled: !!currentSelectionId,
  });
}
