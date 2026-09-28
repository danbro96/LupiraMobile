import { createSelectionCard, deleteSelectionCard } from '../../api/generated/selections/selections';
import type { SelectionEntryDto } from '../../api/generated/models';
import { ApiError } from '../../api/mutator';
import type { EntryAttributes } from './selectionGroups';

export const DEFAULT_ATTRIBUTES: EntryAttributes = { isFoil: false, condition: 'NM', language: 'en' };

export function addEntry(
  selectionId: string,
  printingId: string,
  attrs: EntryAttributes,
  opts: { confidence?: number; allowDuplicate: boolean },
): Promise<SelectionEntryDto> {
  // Picked explicitly: callers pass whole entries/groups, whose extra fields must not reach the body.
  const { isFoil, condition, language } = attrs;
  return createSelectionCard(selectionId, { printingId, isFoil, condition, language, ...opts });
}

/** Already-gone entries (removed on another screen) count as removed. */
export async function removeEntries(selectionId: string, instanceIds: string[]): Promise<void> {
  for (const id of instanceIds) {
    try {
      await deleteSelectionCard(selectionId, id);
    } catch (err: unknown) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }
}

/**
 * The API has no entry update, so an edit re-adds each copy with the new printing/attributes and then
 * deletes the old one. Adding first means a mid-way failure leaves an extra copy rather than a lost card.
 */
export async function replaceEntries(
  selectionId: string,
  instanceIds: string[],
  printingId: string,
  attrs: EntryAttributes,
): Promise<string[]> {
  const created: string[] = [];
  for (const oldId of instanceIds) {
    const entry = await addEntry(selectionId, printingId, attrs, { allowDuplicate: true });
    created.push(entry.instanceId);
    await removeEntries(selectionId, [oldId]);
  }
  return created;
}
