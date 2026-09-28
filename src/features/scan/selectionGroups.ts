import type { CardPrintingDto, SelectionEntryDto } from '../../api/generated/models';

export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const;
export type Condition = (typeof CONDITIONS)[number];

export type EntryAttributes = { isFoil: boolean; condition: string; language: string };

/** Identical copies of one printing (same foil/condition/language), shown as one row with a quantity. */
export type SelectionGroup = EntryAttributes & {
  key: string;
  printing: CardPrintingDto;
  instanceIds: string[];
};

export function groupKey(printingId: string, a: EntryAttributes): string {
  return `${printingId}|${a.isFoil ? 'foil' : 'nonfoil'}|${a.condition}|${a.language}`;
}

/** Groups in first-scanned order. */
export function groupSelectionEntries(entries: SelectionEntryDto[]): SelectionGroup[] {
  const groups = new Map<string, SelectionGroup>();
  for (const e of entries) {
    const key = groupKey(e.printing.id, e);
    const existing = groups.get(key);
    if (existing) {
      existing.instanceIds.push(e.instanceId);
    } else {
      groups.set(key, {
        key,
        printing: e.printing,
        isFoil: e.isFoil,
        condition: e.condition,
        language: e.language,
        instanceIds: [e.instanceId],
      });
    }
  }
  return [...groups.values()];
}

export function nextCondition(current: string): Condition {
  const idx = CONDITIONS.indexOf(current as Condition);
  return CONDITIONS[(idx + 1) % CONDITIONS.length];
}

export type SelectionSummary = { cards: number; foils: number; valueEur: number | null };

export function summariseSelection(entries: SelectionEntryDto[]): SelectionSummary {
  let foils = 0;
  let value = 0;
  let priced = false;
  for (const e of entries) {
    if (e.isFoil) foils++;
    const price = e.isFoil ? e.printing.prices?.eurFoil : e.printing.prices?.eur;
    if (price != null) {
      value += price;
      priced = true;
    }
  }
  return { cards: entries.length, foils, valueEur: priced ? value : null };
}

export function describeSummary(s: SelectionSummary): string {
  const cards = `${s.cards} card${s.cards === 1 ? '' : 's'}`;
  return s.foils > 0 ? `${cards} (${s.foils} foil)` : cards;
}
