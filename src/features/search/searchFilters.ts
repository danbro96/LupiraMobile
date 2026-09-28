import type { ListCardsParams } from '../../api/generated/models';

export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
export const CARD_TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'] as const;
export const RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const;
/** The last mana-value chip reads "7+": selecting it leaves the range open-ended. */
export const CMC_OPEN_END = 7;

export type ManaColor = (typeof MANA_COLORS)[number];
export type Rarity = (typeof RARITIES)[number];
export type CardSort = 'relevance' | 'name' | 'cmc' | 'releasedAt' | 'rarity';
export type SortOrder = 'asc' | 'desc';

export interface CmcRange {
  min: number;
  max: number;
}

export interface SetRef {
  code: string;
  name: string;
}

export interface SearchFilters {
  colors: ManaColor[];
  type?: string;
  rarity?: Rarity;
  cmc?: CmcRange;
  set?: SetRef;
}

export const EMPTY_FILTERS: SearchFilters = { colors: [] };

export interface SortOption {
  label: string;
  sort: CardSort;
  order: SortOrder;
}

export const SORT_OPTIONS: readonly SortOption[] = [
  { label: 'Best match', sort: 'relevance', order: 'desc' },
  { label: 'Name A–Z', sort: 'name', order: 'asc' },
  { label: 'Name Z–A', sort: 'name', order: 'desc' },
  { label: 'Mana value: low to high', sort: 'cmc', order: 'asc' },
  { label: 'Mana value: high to low', sort: 'cmc', order: 'desc' },
  { label: 'Newest first', sort: 'releasedAt', order: 'desc' },
  { label: 'Oldest first', sort: 'releasedAt', order: 'asc' },
  { label: 'Rarest first', sort: 'rarity', order: 'desc' },
  { label: 'Commons first', sort: 'rarity', order: 'asc' },
];

/** Relevance only exists with a query; without one the API falls back to name, so the picker should too. */
export function effectiveSort(option: SortOption, hasQuery: boolean): SortOption {
  return option.sort === 'relevance' && !hasQuery ? SORT_OPTIONS[1] : option;
}

export function toCardParams(q: string, filters: SearchFilters, sort: SortOption): ListCardsParams {
  const query = q.trim();
  const effective = effectiveSort(sort, !!query);
  return {
    q: query || undefined,
    colors: filters.colors.length ? filters.colors.join(',') : undefined,
    type: filters.type,
    rarity: filters.rarity,
    set: filters.set?.code,
    cmcMin: filters.cmc?.min,
    cmcMax: filters.cmc && filters.cmc.max < CMC_OPEN_END ? filters.cmc.max : undefined,
    sort: effective.sort === 'relevance' ? undefined : effective.sort,
    order: effective.sort === 'relevance' ? undefined : effective.order,
  };
}

/** Tap one chip for an exact value, a second to span the range, the lone selected one again to clear. */
export function nextCmcRange(current: CmcRange | undefined, tapped: number): CmcRange | undefined {
  if (!current || current.min !== current.max) return { min: tapped, max: tapped };
  if (current.min === tapped) return undefined;
  return { min: Math.min(current.min, tapped), max: Math.max(current.max, tapped) };
}

export function formatCmc(range: CmcRange): string {
  const max = range.max >= CMC_OPEN_END ? '+' : '';
  if (range.min === range.max) return `MV ${range.min}${max}`;
  return range.max >= CMC_OPEN_END ? `MV ${range.min}+` : `MV ${range.min}–${range.max}`;
}

export interface ActiveFilter {
  key: string;
  label: string;
  clear: (filters: SearchFilters) => SearchFilters;
}

export function activeFilters(filters: SearchFilters): ActiveFilter[] {
  const out: ActiveFilter[] = filters.colors.map(color => ({
    key: `color-${color}`,
    label: color,
    clear: f => ({ ...f, colors: f.colors.filter(c => c !== color) }),
  }));
  if (filters.type) out.push({ key: 'type', label: filters.type, clear: f => ({ ...f, type: undefined }) });
  if (filters.rarity) out.push({ key: 'rarity', label: capitalize(filters.rarity), clear: f => ({ ...f, rarity: undefined }) });
  if (filters.cmc) out.push({ key: 'cmc', label: formatCmc(filters.cmc), clear: f => ({ ...f, cmc: undefined }) });
  if (filters.set) out.push({ key: 'set', label: filters.set.name, clear: f => ({ ...f, set: undefined }) });
  return out;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
