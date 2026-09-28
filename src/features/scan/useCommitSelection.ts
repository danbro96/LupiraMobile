import { useMutation, useQueryClient } from '@tanstack/react-query';
import { commitSelection } from '../../api/generated/selections/selections';
import type { CommitSelectionResponse } from '../../api/generated/models';
import { useSelection } from '../../store/selection-store';
import { toast, toastError } from '../../feedback/toast';
import { hapticSuccess } from '../../feedback/haptics';

/** Commits the whole selection into a collection and remembers that collection as the next default. */
export function useCommitSelection(selectionId: string | null, onDone: () => void) {
  const queryClient = useQueryClient();
  const setCurrent = useSelection(s => s.setCurrent);
  const setLastCollection = useSelection(s => s.setLastCollection);

  return useMutation<CommitSelectionResponse, Error, string>({
    mutationFn: collectionId => commitSelection(selectionId!, { collectionId }),
    onSuccess: async result => {
      if (result.remainingCount === 0) await setCurrent(null);
      await setLastCollection(result.collectionId);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['selection'] }),
        queryClient.invalidateQueries({ queryKey: ['collections'] }),
        queryClient.invalidateQueries({ queryKey: ['collection', result.collectionId] }),
        queryClient.invalidateQueries({ queryKey: ['my-cards'] }),
      ]);

      hapticSuccess();
      toast(`Added ${result.addedCount} card${result.addedCount === 1 ? '' : 's'} to "${result.collectionName}".`);
      onDone();
    },
    onError: e => toastError(`Commit failed: ${e.message}`),
  });
}
