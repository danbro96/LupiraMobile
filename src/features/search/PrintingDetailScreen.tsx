import React, { useMemo } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useGetPrinting } from '../../api/generated/cards/cards';
import { MtgStackParamList } from '../../navigation/types';
import { cardSurface, radii, spacing, useColors, type Palette } from '../../ui/theme';

type Route = RouteProp<MtgStackParamList, 'PrintingDetail'>;

/**
 * Detail of one *specific* printing (set + collector number). Reached from CardDetailScreen's printings
 * picker, or straight from the scan/selection/collection flows where printing identity is what was captured.
 * Hits `GET /cards/{oracleId}/printings/{printingId}`, which cross-checks that the printing belongs to the
 * oracle (404 on mismatch) so this screen doesn't have to.
 */
export function PrintingDetailScreen() {
  const { params } = useRoute<Route>();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { data, isLoading, isError, error } =
    useGetPrinting(params.oracleId, params.printingId);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {isLoading ? <ActivityIndicator style={styles.loading} /> : null}
        {isError ? (
          <Text variant="bodyMedium" style={styles.error}>
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
            <Text variant="headlineSmall" style={styles.name}>{data.name}</Text>
            <Text variant="bodyMedium" style={styles.meta}>
              {data.setName} ({data.setCode.toUpperCase()}) · #{data.collectorNumber}
            </Text>
            <Text variant="bodyMedium" style={styles.meta}>
              {data.rarity}
              {data.colorIdentity.length ? ` · ${data.colorIdentity.join('/')}` : ''}
            </Text>
            {data.prices && Object.keys(data.prices).length ? (
              <View style={styles.pricesBox}>
                <Text variant="titleSmall">Prices</Text>
                {Object.entries(data.prices).map(([key, value]) => {
                  // `prices` mixes numeric fields with a string `updatedAt`; non-numeric
                  // entries fall through to their raw string below.
                  const n = typeof value === 'number' ? value : Number.NaN;
                  return (
                    <Text key={key} variant="bodyMedium">
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    scroll: { padding: spacing.xl, gap: spacing.md, alignItems: 'center' },
    loading: { marginTop: spacing.xxl },
    heroImage: { width: '100%', height: 480, borderRadius: radii.lg, backgroundColor: c.surface },
    name: { fontWeight: '700', marginTop: spacing.sm },
    meta: { color: c.textMuted },
    pricesBox: {
      ...cardSurface(c),
      width: '100%',
      padding: spacing.lg,
      marginTop: spacing.md,
    },
    error: { color: c.danger },
  });
