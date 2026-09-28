import { describe, expect, it } from 'vitest';
import type { SelectionEntryDto } from '../../api/generated/models';
import { describeSummary, groupSelectionEntries, nextCondition, summariseSelection } from './selectionGroups';

function entry(instanceId: string, printingId: string, over: Partial<SelectionEntryDto> = {}): SelectionEntryDto {
  return {
    instanceId,
    printing: {
      id: printingId,
      oracleId: `o-${printingId}`,
      name: printingId,
      setCode: 'lea',
      setName: 'Alpha',
      collectorNumber: '1',
      colorIdentity: [],
      rarity: 'common',
      manaCost: null,
      cmc: null,
      images: null,
      prices: { eur: 1, eurFoil: 5, updatedAt: null },
      faces: null,
    },
    isFoil: false,
    language: 'en',
    condition: 'NM',
    confidence: 1,
    ...over,
  };
}

describe('groupSelectionEntries', () => {
  it('merges identical copies and keeps first-seen order', () => {
    const groups = groupSelectionEntries([entry('1', 'b'), entry('2', 'a'), entry('3', 'b')]);
    expect(groups.map((g) => [g.printing.id, g.instanceIds])).toEqual([
      ['b', ['1', '3']],
      ['a', ['2']],
    ]);
  });

  it('splits the same printing by foil and condition', () => {
    const groups = groupSelectionEntries([
      entry('1', 'a'),
      entry('2', 'a', { isFoil: true }),
      entry('3', 'a', { condition: 'LP' }),
    ]);
    expect(groups).toHaveLength(3);
  });
});

describe('summariseSelection', () => {
  it('counts foils and prices each copy by its finish', () => {
    const s = summariseSelection([entry('1', 'a'), entry('2', 'a', { isFoil: true })]);
    expect(s).toEqual({ cards: 2, foils: 1, valueEur: 6 });
    expect(describeSummary(s)).toBe('2 cards (1 foil)');
  });

  it('reports no value when nothing is priced', () => {
    const e = entry('1', 'a');
    e.printing.prices = null;
    expect(summariseSelection([e]).valueEur).toBeNull();
  });
});

describe('nextCondition', () => {
  it('cycles and wraps', () => {
    expect(nextCondition('NM')).toBe('LP');
    expect(nextCondition('DMG')).toBe('NM');
  });
});
