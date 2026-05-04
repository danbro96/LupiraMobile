import React from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { mtgApi } from '../../api/mtg-client';
import { MtgStackParamList } from '../../navigation/types';

type Route = RouteProp<MtgStackParamList, 'CardDetail'>;

export function CardDetailScreen() {
  const { params } = useRoute<Route>();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cards', 'printing', params.printingId],
    queryFn: ({ signal }) => mtgApi.getPrinting(params.printingId, signal),
  });

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {isLoading ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
        {isError ? <Text style={styles.error}>{(error as Error).message}</Text> : null}
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
                {Object.entries(data.prices).map(([key, value]) => (
                  <Text key={key} style={styles.priceLine}>
                    {key}: {value.toFixed(2)}
                  </Text>
                ))}
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
