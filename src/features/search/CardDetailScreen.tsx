import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  useGetCardsOracleId,
  useGetCardsOracleIdPrintings,
} from '../../api/generated/cards/cards';
import type { CardPrintingResponse } from '../../api/generated/models';
import { MtgStackParamList } from '../../navigation/types';
import { ColorPips } from './ColorPips';

type Route = RouteProp<MtgStackParamList, 'CardDetail'>;
type Nav = NativeStackNavigationProp<MtgStackParamList, 'CardDetail'>;

/**
 * Oracle-level (functionally distinct) card detail: the abstract data (name, type line, oracle text, colour
 * identity, P/T) plus the representative thumbnail, over a horizontally-scrolling printings picker — the
 * set-specific image, prices and collector number live on the printing, not the oracle.
 */
export function CardDetailScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();

  const cardQuery = useGetCardsOracleId(params.oracleId);
  const printingsQuery = useGetCardsOracleIdPrintings(params.oracleId);

  const card = cardQuery.data;
  const printings = printingsQuery.data?.results ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {cardQuery.isLoading ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
        {cardQuery.isError ? (
          <Text style={styles.error}>{(cardQuery.error as unknown as Error)?.message ?? 'Unknown error'}</Text>
        ) : null}

        {card ? (
          <>
            {card.thumbnail?.normal ? (
              <Image
                source={{ uri: card.thumbnail.normal }}
                style={styles.heroImage}
                resizeMode="contain"
              />
            ) : null}

            <View style={styles.titleRow}>
              <Text style={styles.name}>{card.name}</Text>
              <ColorPips colors={card.colorIdentity} />
            </View>

            <Text style={styles.typeLine}>{card.typeLine}</Text>

            {card.power || card.toughness ? (
              <Text style={styles.pt}>
                {card.power ?? '—'} / {card.toughness ?? '—'}
              </Text>
            ) : null}

            {card.oracleText ? (
              <View style={styles.oracleBox}>
                <Text style={styles.oracleText}>{card.oracleText}</Text>
              </View>
            ) : null}

            <View style={styles.printingsHeader}>
              <Text style={styles.printingsTitle}>Printings</Text>
              <Text style={styles.printingsCount}>
                {card.printingCount} total
                {printingsQuery.isFetching ? ' · loading…' : ''}
              </Text>
            </View>

            {printingsQuery.isError ? (
              <Text style={styles.error}>
                Couldn't load printings: {(printingsQuery.error as unknown as Error)?.message ?? 'Unknown error'}
              </Text>
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.printingsRow}
            >
              {printings.map((p) => (
                <PrintingTile
                  key={p.id}
                  printing={p}
                  onPress={() =>
                    navigation.navigate('PrintingDetail', {
                      oracleId: card.oracleId,
                      printingId: p.id,
                    })
                  }
                />
              ))}
            </ScrollView>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PrintingTile({
  printing,
  onPress,
}: {
  printing: CardPrintingResponse;
  onPress: () => void;
}) {
  const thumb = printing.images?.artCrop ?? printing.images?.normal ?? null;
  return (
    <Pressable onPress={onPress} style={styles.printingTile}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.printingThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.printingThumb, styles.printingThumbPlaceholder]} />
      )}
      <Text style={styles.printingSet} numberOfLines={1}>
        {printing.setCode.toUpperCase()}
      </Text>
      <Text style={styles.printingMeta} numberOfLines={1}>
        #{printing.collectorNumber} · {printing.rarity[0]?.toUpperCase() ?? ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  scroll: { padding: 24, gap: 12 },
  heroImage: { width: '100%', height: 480, borderRadius: 16, backgroundColor: '#1a1f29' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  name: { color: '#f5f5f5', fontSize: 24, fontWeight: '700', flexShrink: 1 },
  typeLine: { color: '#cbd1da', fontSize: 14 },
  pt: { color: '#cbd1da', fontSize: 14, fontWeight: '600' },
  oracleBox: {
    backgroundColor: '#1a1f29',
    padding: 14,
    borderRadius: 8,
    marginTop: 4,
  },
  oracleText: { color: '#cbd1da', fontSize: 14, lineHeight: 20 },
  printingsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  printingsTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '700' },
  printingsCount: { color: '#6e7686', fontSize: 12 },
  printingsRow: { gap: 10, paddingVertical: 4 },
  printingTile: {
    width: 96,
    gap: 4,
    alignItems: 'center',
  },
  printingThumb: {
    width: 96,
    height: 96,
    borderRadius: 8,
    backgroundColor: '#1a1f29',
  },
  printingThumbPlaceholder: { backgroundColor: '#1a1f29' },
  printingSet: { color: '#f5f5f5', fontSize: 12, fontWeight: '700' },
  printingMeta: { color: '#9aa3b2', fontSize: 11 },
  error: { color: '#f97373', fontSize: 14 },
});
