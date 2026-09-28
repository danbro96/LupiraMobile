import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, SORT_OPTIONS, activeFilters, formatCmc, nextCmcRange, toCardParams } from './searchFilters';

const [relevance, nameAsc] = SORT_OPTIONS;
const cmcDesc = SORT_OPTIONS.find(o => o.sort === 'cmc' && o.order === 'desc')!;

describe('toCardParams', () => {
  it('sends only the sort for an empty search', () => {
    expect(toCardParams('  ', EMPTY_FILTERS, nameAsc)).toEqual({ sort: 'name', order: 'asc' });
  });

  it('drops relevance without a query and lets the API default to name', () => {
    expect(toCardParams('', EMPTY_FILTERS, relevance)).toMatchObject({ sort: 'name', order: 'asc' });
    expect(toCardParams('bolt', EMPTY_FILTERS, relevance)).toMatchObject({ q: 'bolt', sort: undefined, order: undefined });
  });

  it('maps every filter', () => {
    const params = toCardParams('', {
      colors: ['W', 'U'],
      type: 'Creature',
      rarity: 'rare',
      cmc: { min: 2, max: 4 },
      set: { code: 'm21', name: 'Core Set 2021' },
    }, cmcDesc);
    expect(params).toMatchObject({
      colors: 'W,U', type: 'Creature', rarity: 'rare', set: 'm21', cmcMin: 2, cmcMax: 4, sort: 'cmc', order: 'desc',
    });
  });

  it('leaves the 7+ end open', () => {
    const params = toCardParams('', { ...EMPTY_FILTERS, cmc: { min: 5, max: 7 } }, nameAsc);
    expect(params.cmcMin).toBe(5);
    expect(params.cmcMax).toBeUndefined();
  });
});

describe('nextCmcRange', () => {
  it('selects, extends, restarts and clears', () => {
    const one = nextCmcRange(undefined, 3);
    expect(one).toEqual({ min: 3, max: 3 });
    const span = nextCmcRange(one, 1);
    expect(span).toEqual({ min: 1, max: 3 });
    expect(nextCmcRange(span, 5)).toEqual({ min: 5, max: 5 });
    expect(nextCmcRange(one, 3)).toBeUndefined();
  });
});

describe('formatCmc', () => {
  it('labels exact, spans and the open end', () => {
    expect(formatCmc({ min: 2, max: 2 })).toBe('MV 2');
    expect(formatCmc({ min: 1, max: 3 })).toBe('MV 1–3');
    expect(formatCmc({ min: 4, max: 7 })).toBe('MV 4+');
    expect(formatCmc({ min: 7, max: 7 })).toBe('MV 7+');
  });
});

describe('activeFilters', () => {
  it('lists one removable chip per filter', () => {
    const filters = { colors: ['R' as const], rarity: 'mythic' as const };
    const chips = activeFilters(filters);
    expect(chips.map(c => c.label)).toEqual(['R', 'Mythic']);
    expect(chips[0].clear(filters).colors).toEqual([]);
  });
});
