import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { keepPreviousData } from '@tanstack/react-query';
import { useListCards } from '../../api/generated/cards/cards';
import type { CardDto } from '../../api/generated/models';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { MtgStackParamList } from '../../navigation/types';
import { ColorPips } from './ColorPips';

type Nav = NativeStackNavigationProp<MtgStackParamList, 'Search'>;

/**
 * Catalogue search keyed on functionally distinct cards (oracle level), not
 * printings. Lightning Bolt now appears once with a `printingCount` badge
 * instead of 50+ times. Drill into a row → CardDetailScreen for the abstract
 * card, then optionally pick a specific printing.
 */
export function SearchScreen() {
  const navigation = useNavigation<Nav>();
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Cards</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name (e.g. lightning bolt)"
          placeholderTextColor="#6e7686"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.totalText}>{totalText}</Text>
      </View>

      {isError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{(error as Error).message}</Text>
          <Pressable onPress={() => refetch()} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={data?.results ?? []}
        keyExtractor={(c) => c.oracleId}
        renderItem={({ item }) => (
          <CardRow
            card={item}
            onPress={() => navigation.navigate('CardDetail', { oracleId: item.oracleId })}
          />
        )}
        ListEmptyComponent={
          isFetching ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
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
    </SafeAreaView>
  );
}

function CardRow({ card, onPress }: { card: CardDto; onPress: () => void }) {
  const thumb = card.thumbnail?.artCrop ?? card.thumbnail?.normal ?? null;
  return (
    <Pressable onPress={onPress} style={styles.row}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Text style={styles.thumbPlaceholderText}>{card.name.slice(0, 2).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.rowText}>
        <View style={styles.nameRow}>
          <Text style={styles.cardName} numberOfLines={1}>
            {card.name}
          </Text>
          <ColorPips colors={card.colorIdentity} />
        </View>
        <Text style={styles.typeLine} numberOfLines={1}>
          {card.typeLine}
        </Text>
        <Text style={styles.cardMeta}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  header: { padding: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: '#1a1f29' },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '700' },
  input: {
    backgroundColor: '#1a1f29',
    color: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2c3340',
  },
  totalText: { color: '#6e7686', fontSize: 12 },
  list: { padding: 16, gap: 12 },
  row: {
    flexDirection: 'row',
    backgroundColor: '#1a1f29',
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    padding: 8,
    gap: 12,
  },
  thumb: { width: 64, height: 64, borderRadius: 6, backgroundColor: '#2c3340' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  thumbPlaceholderText: { color: '#9aa3b2', fontSize: 18, fontWeight: '700' },
  rowText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { color: '#f5f5f5', fontSize: 16, fontWeight: '600', flexShrink: 1 },
  typeLine: { color: '#cbd1da', fontSize: 12 },
  cardMeta: { color: '#6e7686', fontSize: 12 },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: { color: '#6e7686', fontSize: 14, textAlign: 'center' },
  errorBox: { padding: 16, gap: 8, backgroundColor: '#2a1414', margin: 16, borderRadius: 8 },
  errorText: { color: '#f97373', fontSize: 14 },
  retryButton: { alignSelf: 'flex-start', backgroundColor: '#f97373', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  retryButtonText: { color: '#fff', fontWeight: '600' },
  bottomSpinner: { position: 'absolute', bottom: 24, alignSelf: 'center' },
});
