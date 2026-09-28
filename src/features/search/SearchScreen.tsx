import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Badge, Chip, Searchbar, Text } from 'react-native-paper';
import { Image } from 'expo-image';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { listCards } from '../../api/generated/cards/cards';
import type { CardDto } from '../../api/generated/models';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { MtgStackParamList } from '../../navigation/types';
import { useSearchPrefs } from '../../store/search-prefs-store';
import { ActionMenu } from '../../ui/components/ActionMenu';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { ScreenToolbar } from '../../ui/components/ScreenToolbar';
import { cardSurface, radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';
import { extraIdentity, ManaCost } from '../../ui/symbols';
import { ColorPips } from './ColorPips';
import { SearchFiltersSheet } from './SearchFiltersSheet';
import {
  EMPTY_FILTERS,
  SORT_OPTIONS,
  activeFilters,
  effectiveSort,
  toCardParams,
  type SearchFilters,
  type SortOption,
} from './searchFilters';

type Nav = NativeStackNavigationProp<MtgStackParamList, 'Search'>;
type Styles = ReturnType<typeof makeStyles>;

const PAGE_SIZE = 50;
/** Scryfall `normal` images are 488×680. */
const CARD_ASPECT = 488 / 680;

/**
 * Catalogue search keyed on functionally distinct cards (oracle level), not
 * printings. Lightning Bolt now appears once with a `printingCount` badge
 * instead of 50+ times. Drill into a row → CardDetailScreen for the abstract
 * card, then optionally pick a specific printing.
 */
export function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const prefs = useSearchPrefs();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [sortOption, setSortOption] = useState<SortOption>(SORT_OPTIONS[0]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  useEffect(() => {
    if (!prefs.loaded) void prefs.load();
  }, [prefs]);

  const params = useMemo(() => toCardParams(debounced, filters, sortOption), [debounced, filters, sortOption]);
  const cards = useInfiniteQuery({
    queryKey: ['cards', 'search', params],
    queryFn: ({ pageParam, signal }) => listCards({ ...params, take: PAGE_SIZE, skip: pageParam }, { signal }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.results.length, 0);
      return last.results.length && loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });

  // Offset paging over a live catalogue can repeat a row across page boundaries; FlashList needs unique keys.
  const results = useMemo(() => {
    const seen = new Map<string, CardDto>();
    for (const page of cards.data?.pages ?? []) for (const card of page.results) seen.set(card.oracleId, card);
    return [...seen.values()];
  }, [cards.data]);
  const total = cards.data?.pages[0]?.total;

  const chips = activeFilters(filters);
  const grid = prefs.viewMode === 'grid';
  const hasQuery = !!debounced.trim();
  const currentSort = effectiveSort(sortOption, hasQuery);

  const openCard = useCallback(
    (card: CardDto) => {
      if (query.trim()) void useSearchPrefs.getState().addRecent(query);
      navigation.navigate('CardDetail', { oracleId: card.oracleId });
    },
    [navigation, query],
  );

  const renderItem = useCallback<ListRenderItem<CardDto>>(
    ({ item }) =>
      grid ? <CardTile card={item} styles={styles} onPress={openCard} /> : <CardRow card={item} styles={styles} onPress={openCard} />,
    [grid, styles, openCard],
  );

  const onEndReached = () => {
    if (cards.hasNextPage && !cards.isFetchingNextPage) void cards.fetchNextPage();
  };

  const countText = cards.isFetching && !cards.isFetchingNextPage
    ? 'Searching…'
    : total === undefined
      ? ''
      : `${total.toLocaleString()} card${total === 1 ? '' : 's'} · ${currentSort.label}`;

  return (
    <View style={styles.container}>
      <ScreenToolbar>
        <Searchbar
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void prefs.addRecent(query)}
          placeholder="Search cards"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
          inputStyle={styles.searchInput}
        />
        <View>
          <IconButton name={ICONS.filter} accessibilityLabel="Filters" onPress={() => setFiltersOpen(true)} />
          {chips.length ? <Badge size={16} style={styles.badge}>{chips.length}</Badge> : null}
        </View>
        <IconButton name={ICONS.sort} accessibilityLabel="Sort" onPress={() => setSortOpen(true)} />
        <IconButton
          name={grid ? ICONS.listView : ICONS.gridView}
          accessibilityLabel={grid ? 'Show as list' : 'Show as grid'}
          onPress={() => void prefs.setViewMode(grid ? 'list' : 'grid')}
        />
      </ScreenToolbar>

      {chips.length ? (
        <ChipRow>
          {chips.map(chip => (
            <Chip key={chip.key} compact onClose={() => setFilters(chip.clear(filters))}>{chip.label}</Chip>
          ))}
        </ChipRow>
      ) : !query && prefs.recent.length ? (
        <ChipRow>
          {prefs.recent.map(recent => (
            <Chip key={recent} compact icon={ICONS.history} onPress={() => setQuery(recent)}
              onClose={() => void prefs.removeRecent(recent)}>{recent}</Chip>
          ))}
        </ChipRow>
      ) : null}

      <Text variant="bodySmall" style={styles.countText}>{countText}</Text>

      {cards.isError ? (
        <View style={styles.errorBox}>
          <Text variant="bodyMedium" style={styles.errorText}>{(cards.error as Error).message}</Text>
          <Button title="Retry" variant="destructive" onPress={() => void cards.refetch()} style={styles.retryButton} />
        </View>
      ) : null}

      <FlashList
        key={prefs.viewMode}
        data={results}
        numColumns={grid ? 2 : 1}
        keyExtractor={card => card.oracleId}
        renderItem={renderItem}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={grid ? styles.gridContent : styles.listContent}
        ListFooterComponent={cards.isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : null}
        ListEmptyComponent={
          cards.isFetching ? null : (
            <View style={styles.empty}>
              <Text variant="bodyMedium" style={styles.emptyText}>
                {query || chips.length ? 'No cards match.' : 'Start typing to search the catalog.'}
              </Text>
            </View>
          )
        }
      />

      {filtersOpen ? (
        <SearchFiltersSheet filters={filters} onChange={setFilters} onDismiss={() => setFiltersOpen(false)} />
      ) : null}

      <ActionMenu
        visible={sortOpen}
        title="Sort by"
        onClose={() => setSortOpen(false)}
        actions={SORT_OPTIONS.filter(o => hasQuery || o.sort !== 'relevance').map(o => ({
          label: o.label,
          selected: o === currentSort,
          onPress: () => setSortOption(o),
        }))}
      />
    </View>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={chipRowStyles.row}
      style={chipRowStyles.scroll}
    >
      {children}
    </ScrollView>
  );
}

const CardRow = memo(function CardRow({ card, styles, onPress }: { card: CardDto; styles: Styles; onPress: (card: CardDto) => void }) {
  const thumb = card.thumbnail?.artCrop ?? card.thumbnail?.normal ?? null;
  return (
    <Pressable onPress={() => onPress(card)} style={styles.row}>
      {thumb ? (
        <Image source={thumb} recyclingKey={card.oracleId} style={styles.thumb} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Text variant="titleMedium" style={styles.thumbPlaceholderText}>{card.name.slice(0, 2).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.rowText}>
        <View style={styles.nameRow}>
          <Text variant="titleMedium" style={styles.cardName} numberOfLines={1}>
            {card.name}
          </Text>
          <ManaCost cost={card.manaCost} />
        </View>
        <Text variant="bodySmall" style={styles.typeLine} numberOfLines={1}>
          {card.typeLine}
        </Text>
        <View style={styles.metaRow}>
          <Text variant="bodySmall" style={styles.cardMeta}>
            {card.printingCount} printing{card.printingCount === 1 ? '' : 's'}
          </Text>
          <ColorPips colors={extraIdentity(card.colorIdentity, card.manaCost)} size={13} />
        </View>
      </View>
    </Pressable>
  );
});

const CardTile = memo(function CardTile({ card, styles, onPress }: { card: CardDto; styles: Styles; onPress: (card: CardDto) => void }) {
  const image = card.thumbnail?.normal ?? null;
  return (
    <Pressable onPress={() => onPress(card)} style={styles.tile} accessibilityLabel={card.name}>
      {image ? (
        <Image source={image} recyclingKey={card.oracleId} style={styles.tileImage} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.tileImage, styles.tilePlaceholder]}>
          <Text variant="titleSmall" style={styles.tilePlaceholderText}>{card.name}</Text>
        </View>
      )}
    </Pressable>
  );
});

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const chipRowStyles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    search: { flex: 1, height: 44 },
    searchInput: { minHeight: 0 },
    badge: { position: 'absolute', top: 0, right: 0 },
    countText: { color: c.textSubtle, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
    listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
    gridContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
    row: {
      ...cardSurface(c),
      flexDirection: 'row',
      overflow: 'hidden',
      alignItems: 'center',
      padding: spacing.sm,
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    thumb: { width: 64, height: 64, borderRadius: radii.sm, backgroundColor: c.border },
    thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    thumbPlaceholderText: { color: c.textMuted, fontWeight: '700' },
    rowText: { flex: 1, gap: 2 },
    nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    cardName: { flexShrink: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    typeLine: { color: c.text },
    cardMeta: { color: c.textSubtle },
    tile: { flex: 1, padding: spacing.xs },
    // Card corners are ~4.7% of the width; radii.md is close at two-column size.
    tileImage: { width: '100%', aspectRatio: CARD_ASPECT, borderRadius: radii.md, backgroundColor: c.surface },
    tilePlaceholder: { alignItems: 'center', justifyContent: 'center', padding: spacing.sm },
    tilePlaceholderText: { color: c.textMuted, textAlign: 'center' },
    footer: { padding: spacing.lg },
    empty: { padding: spacing.xl, alignItems: 'center' },
    emptyText: { color: c.textSubtle, textAlign: 'center' },
    errorBox: {
      padding: spacing.lg,
      gap: spacing.sm,
      backgroundColor: c.dangerBg,
      margin: spacing.lg,
      borderRadius: radii.md,
    },
    errorText: { color: c.danger },
    retryButton: { alignSelf: 'flex-start' },
  });
