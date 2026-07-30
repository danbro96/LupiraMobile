import React from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useGetCardsOracleIdPrintingsPrintingId } from '../../api/generated/cards/cards';
import { MtgStackParamList } from '../../navigation/types';

type Route = RouteProp<MtgStackParamList, 'PrintingDetail'>;

/**
 * Detail of one *specific* printing (set + collector number). Reached from CardDetailScreen's printings
 * picker, or straight from the scan/selection/collection flows where printing identity is what was captured.
 * Hits `GET /cards/{oracleId}/printings/{printingId}`, which cross-checks that the printing belongs to the
 * oracle (404 on mismatch) so this screen doesn't have to.
 */
export function PrintingDetailScreen() {
  const { params } = useRoute<Route>();
  const { data: envelope, isLoading, isError, error } =
    useGetCardsOracleIdPrintingsPrintingId(params.oracleId, params.printingId);
  // Orval envelope: `.data?.data` is the `CardPrintingResponse`.
  const data = envelope?.data;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {isLoading ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
        {isError ? (
          <Text style={styles.error}>
            {(error as unknown as Error)?.message ?? 'Unknown error'}
          </Text>
        ) : null}
        {data ? (
          <>
            {data.images?.normal ? (
              <Image
                source={{ uri: data.images.normal }}
                style={styles.heroImage}
                resizeMode="contain"
              />
            ) : null}
            <Text style={styles.name}>{data.name}</Text>
            <Text style={styles.meta}>
              {data.setName} ({data.setCode.toUpperCase()}) · #{data.collectorNumber}
            </Text>
            <Text style={styles.meta}>
              {data.rarity}
              {data.colorIdentity.length ? ` · ${data.colorIdentity.join('/')}` : ''}
            </Text>
            {data.prices && Object.keys(data.prices).length ? (
              <View style={styles.pricesBox}>
                <Text style={styles.pricesTitle}>Prices</Text>
                {Object.entries(data.prices).map(([key, value]) => {
                  // `prices` mixes numeric fields with a string `updatedAt`; non-numeric
                  // entries fall through to their raw string below.
                  const n = typeof value === 'number' ? value : Number.NaN;
                  return (
                    <Text key={key} style={styles.priceLine}>
                      {key}: {Number.isFinite(n) ? n.toFixed(2) : String(value)}
                    </Text>
                  );
                })}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  scroll: { padding: 24, gap: 12, alignItems: 'center' },
  heroImage: { width: '100%', height: 480, borderRadius: 16, backgroundColor: '#1a1f29' },
  name: { color: '#f5f5f5', fontSize: 24, fontWeight: '700', marginTop: 8 },
  meta: { color: '#9aa3b2', fontSize: 14 },
  pricesBox: {
    width: '100%',
    backgroundColor: '#1a1f29',
    padding: 16,
    borderRadius: 8,
    gap: 4,
    marginTop: 12,
  },
  pricesTitle: { color: '#f5f5f5', fontSize: 14, fontWeight: '700' },
  priceLine: { color: '#cbd1da', fontSize: 14 },
  error: { color: '#f97373', fontSize: 14 },
});
