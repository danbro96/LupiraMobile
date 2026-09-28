import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Chip, List, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { listSets } from '../../api/generated/sets/sets';
import type { SetDto } from '../../api/generated/models';
import { Button } from '../../ui/components/Button';
import { TextField } from '../../ui/components/TextField';
import { ManaSymbol } from '../../ui/symbols';
import { radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';
import {
  CARD_TYPES,
  CMC_OPEN_END,
  EMPTY_FILTERS,
  MANA_COLORS,
  RARITIES,
  capitalize,
  nextCmcRange,
  type SearchFilters,
} from './searchFilters';

const SET_PAGE = 200;
const SET_MATCHES = 6;
const CMC_VALUES = Array.from({ length: CMC_OPEN_END + 1 }, (_, i) => i);

/** Every set, once per session: `/sets` has no name filter, and the whole list is ~1k small rows. */
function useAllSets() {
  return useQuery({
    queryKey: ['sets', 'all'],
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const all: SetDto[] = [];
      for (;;) {
        const page = await listSets({ sort: 'releasedAt', order: 'desc', take: SET_PAGE, skip: all.length }, { signal });
        all.push(...page.results);
        if (!page.results.length || all.length >= page.total) return all;
      }
    },
  });
}

/** Filter controls in the same Portal-and-backdrop sheet shape Cal uses; changes apply live. */
export function SearchFiltersSheet({
  filters,
  onChange,
  onDismiss,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  onDismiss: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [setQuery, setSetQuery] = useState('');
  const sets = useAllSets();

  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });
  const toggleColor = (color: (typeof MANA_COLORS)[number]) =>
    set({ colors: filters.colors.includes(color) ? filters.colors.filter(x => x !== color) : [...filters.colors, color] });

  const setMatches = useMemo(() => {
    const q = setQuery.trim().toLowerCase();
    if (!q || !sets.data) return [];
    return sets.data
      .filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase() === q)
      .slice(0, SET_MATCHES);
  }, [setQuery, sets.data]);

  const cmcSelected = (n: number) => !!filters.cmc && n >= filters.cmc.min && n <= filters.cmc.max;

  return (
    <Portal>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text variant="titleMedium">Filters</Text>

            <Text variant="labelMedium" style={styles.label}>Colour identity (all of)</Text>
            <View style={styles.row}>
              {MANA_COLORS.map(color => {
                const selected = filters.colors.includes(color);
                return (
                  <Pressable
                    key={color}
                    onPress={() => toggleColor(color)}
                    style={[styles.mana, selected && styles.manaSelected]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <View style={!selected && styles.manaDimmed}>
                      <ManaSymbol code={color} size={30} />
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text variant="labelMedium" style={styles.label}>Type</Text>
            <View style={styles.row}>
              {CARD_TYPES.map(type => (
                <Chip key={type} compact selected={filters.type === type} showSelectedCheck
                  onPress={() => set({ type: filters.type === type ? undefined : type })}>{type}</Chip>
              ))}
            </View>

            <Text variant="labelMedium" style={styles.label}>Rarity</Text>
            <View style={styles.row}>
              {RARITIES.map(rarity => (
                <Chip key={rarity} compact selected={filters.rarity === rarity} showSelectedCheck
                  onPress={() => set({ rarity: filters.rarity === rarity ? undefined : rarity })}>{capitalize(rarity)}</Chip>
              ))}
            </View>

            <Text variant="labelMedium" style={styles.label}>Mana value (tap two to span a range)</Text>
            <View style={styles.row}>
              {CMC_VALUES.map(n => (
                <Chip key={n} compact selected={cmcSelected(n)}
                  onPress={() => set({ cmc: nextCmcRange(filters.cmc, n) })}>{n === CMC_OPEN_END ? `${n}+` : String(n)}</Chip>
              ))}
            </View>

            <Text variant="labelMedium" style={styles.label}>Set</Text>
            {filters.set ? (
              <View style={styles.row}>
                <Chip icon={ICONS.layers} onClose={() => set({ set: undefined })}>{filters.set.name}</Chip>
              </View>
            ) : (
              <>
                <TextField
                  label="Set name or code"
                  value={setQuery}
                  onChangeText={setSetQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.setInput}
                />
                {setMatches.map(s => (
                  <List.Item
                    key={s.code}
                    title={s.name}
                    description={`${s.code.toUpperCase()}${s.releasedAt ? ` · ${s.releasedAt.slice(0, 4)}` : ''}`}
                    onPress={() => {
                      set({ set: { code: s.code, name: s.name } });
                      setSetQuery('');
                    }}
                  />
                ))}
                {sets.isLoading && setQuery ? <Text variant="bodySmall" style={styles.hint}>Loading sets…</Text> : null}
              </>
            )}

            <View style={styles.actions}>
              <Button variant="text" title="Clear all" onPress={() => onChange(EMPTY_FILTERS)} />
              <Button title="Done" onPress={onDismiss} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Portal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      padding: spacing.lg,
      maxHeight: '85%',
    },
    label: { color: c.textMuted, marginTop: spacing.lg, marginBottom: spacing.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    mana: { padding: 3, borderRadius: radii.round, borderWidth: 2, borderColor: 'transparent' },
    manaSelected: { borderColor: c.primary },
    manaDimmed: { opacity: 0.35 },
    setInput: { flex: 0 },
    hint: { color: c.textSubtle, marginTop: spacing.sm },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xl },
  });
