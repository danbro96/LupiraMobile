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
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { mtgApi } from '../../api/mtg-client';
import { CardPrintingResponse } from '../../api/mtg-types';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { MtgStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<MtgStackParamList, 'Search'>;

export function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['cards', 'search', debounced],
    queryFn: ({ signal }) => mtgApi.searchCards({ q: debounced || undefined, limit: 50 }, signal),
    placeholderData: keepPreviousData,
    enabled: true,
  });

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
        keyExtractor={c => c.id}
        renderItem={({ item }) => (
          <CardRow card={item} onPress={() => navigation.navigate('CardDetail', { printingId: item.id })} />
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

function CardRow({ card, onPress }: { card: CardPrintingResponse; onPress: () => void }) {
  const thumb = card.images?.artCrop ?? card.images?.normal ?? null;
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
        <Text style={styles.cardName}>{card.name}</Text>
        <Text style={styles.cardMeta}>
          {card.setCode.toUpperCase()} · #{card.collectorNumber} · {card.rarity}
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
  cardName: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  cardMeta: { color: '#9aa3b2', fontSize: 12 },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: { color: '#6e7686', fontSize: 14, textAlign: 'center' },
  errorBox: { padding: 16, gap: 8, backgroundColor: '#2a1414', margin: 16, borderRadius: 8 },
  errorText: { color: '#f97373', fontSize: 14 },
  retryButton: { alignSelf: 'flex-start', backgroundColor: '#f97373', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  retryButtonText: { color: '#fff', fontWeight: '600' },
  bottomSpinner: { position: 'absolute', bottom: 24, alignSelf: 'center' },
});
