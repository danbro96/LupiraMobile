import React, { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { keepPreviousData } from '@tanstack/react-query';
import { useListCards } from '../../api/generated/cards/cards';
import type { CardDto } from '../../api/generated/models';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { MtgStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { TextField } from '../../ui/components/TextField';
import { cardSurface, radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ColorPips } from './ColorPips';

type Nav = NativeStackNavigationProp<MtgStackParamList, 'Search'>;
type Styles = ReturnType<typeof makeStyles>;

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
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);

  const { data, isFetching, isError, error, refetch } = useListCards(
    { q: debounced || undefined, take: 50 },
    { query: { placeholderData: keepPreviousData } },
  );

  const totalText = useMemo(() => {
    if (isFetching) return 'Searching…';
    if (!data) return '';
    return `${data.results.length} of ${data.total}`;
  }, [data, isFetching]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name (e.g. lightning bolt)"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Text variant="bodySmall" style={styles.totalText}>{totalText}</Text>
      </View>

      {isError ? (
        <View style={styles.errorBox}>
          <Text variant="bodyMedium" style={styles.errorText}>{(error as Error).message}</Text>
          <Button title="Retry" variant="destructive" onPress={() => refetch()} style={styles.retryButton} />
        </View>
      ) : null}

      <FlatList
        data={data?.results ?? []}
        keyExtractor={(card) => card.oracleId}
        renderItem={({ item }) => (
          <CardRow
            card={item}
            styles={styles}
            onPress={() => navigation.navigate('CardDetail', { oracleId: item.oracleId })}
          />
        )}
        ListEmptyComponent={
          isFetching ? null : (
            <View style={styles.empty}>
              <Text variant="bodyMedium" style={styles.emptyText}>
                {query ? 'No cards match that search.' : 'Start typing to search the catalog.'}
              </Text>
            </View>
          )
        }
        contentContainerStyle={styles.list}
      />

      {isFetching && data?.results.length ? (
        <ActivityIndicator style={styles.bottomSpinner} />
      ) : null}
    </View>
  );
}

function CardRow({ card, styles, onPress }: { card: CardDto; styles: Styles; onPress: () => void }) {
  const thumb = card.thumbnail?.artCrop ?? card.thumbnail?.normal ?? null;
  return (
    <Pressable onPress={onPress} style={styles.row}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
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
          <ColorPips colors={card.colorIdentity} />
        </View>
        <Text variant="bodySmall" style={styles.typeLine} numberOfLines={1}>
          {card.typeLine}
        </Text>
        <Text variant="bodySmall" style={styles.cardMeta}>
          {card.printingCount} printing{card.printingCount === 1 ? '' : 's'}
        </Text>
      </View>
    </Pressable>
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    header: {
      padding: spacing.lg,
      gap: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    // TextField defaults to flex: 1 for row layouts; here it sits in a column.
    input: { flex: 0 },
    totalText: { color: c.textSubtle },
    list: { padding: spacing.lg, gap: spacing.md },
    row: {
      ...cardSurface(c),
      flexDirection: 'row',
      overflow: 'hidden',
      alignItems: 'center',
      padding: spacing.sm,
      gap: spacing.md,
    },
    thumb: { width: 64, height: 64, borderRadius: radii.sm, backgroundColor: c.border },
    thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    thumbPlaceholderText: { color: c.textMuted, fontWeight: '700' },
    rowText: { flex: 1, gap: 2 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardName: { flexShrink: 1 },
    typeLine: { color: c.text },
    cardMeta: { color: c.textSubtle },
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
    bottomSpinner: { position: 'absolute', bottom: spacing.xl, alignSelf: 'center' },
  });
