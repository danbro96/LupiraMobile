import React, { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  useGetCard,
  useListPrintings,
} from '../../api/generated/cards/cards';
import type { CardPrintingDto } from '../../api/generated/models';
import { MtgStackParamList } from '../../navigation/types';
import { cardSurface, radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ColorPips } from './ColorPips';

type Route = RouteProp<MtgStackParamList, 'CardDetail'>;
type Nav = NativeStackNavigationProp<MtgStackParamList, 'CardDetail'>;
type Styles = ReturnType<typeof makeStyles>;

/**
 * Oracle-level (functionally distinct) card detail: the abstract data (name, type line, oracle text, colour
 * identity, P/T) plus the representative thumbnail, over a horizontally-scrolling printings picker — the
 * set-specific image, prices and collector number live on the printing, not the oracle.
 */
export function CardDetailScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const cardQuery = useGetCard(params.oracleId);
  const printingsQuery = useListPrintings(params.oracleId);

  const card = cardQuery.data;
  const printings = printingsQuery.data ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {cardQuery.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
        {cardQuery.isError ? (
          <Text variant="bodyMedium" style={styles.error}>
            {(cardQuery.error as unknown as Error)?.message ?? 'Unknown error'}
          </Text>
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
              <Text variant="headlineSmall" style={styles.name}>{card.name}</Text>
              <ColorPips colors={card.colorIdentity} />
            </View>

            <Text variant="bodyMedium">{card.typeLine}</Text>

            {card.power || card.toughness ? (
              <Text variant="bodyMedium" style={styles.pt}>
                {card.power ?? '—'} / {card.toughness ?? '—'}
              </Text>
            ) : null}

            {card.oracleText ? (
              <View style={styles.oracleBox}>
                <Text variant="bodyMedium" style={styles.oracleText}>{card.oracleText}</Text>
              </View>
            ) : null}

            <View style={styles.printingsHeader}>
              <Text variant="titleMedium" style={styles.printingsTitle}>Printings</Text>
              <Text variant="bodySmall" style={styles.printingsCount}>
                {card.printingCount} total
                {printingsQuery.isFetching ? ' · loading…' : ''}
              </Text>
            </View>

            {printingsQuery.isError ? (
              <Text variant="bodyMedium" style={styles.error}>
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
                  styles={styles}
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
  styles,
  onPress,
}: {
  printing: CardPrintingDto;
  styles: Styles;
  onPress: () => void;
}) {
  const thumb = printing.images?.artCrop ?? printing.images?.normal ?? null;
  return (
    <Pressable onPress={onPress} style={styles.printingTile}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.printingThumb} resizeMode="cover" />
      ) : (
        <View style={styles.printingThumb} />
      )}
      <Text variant="labelMedium" style={styles.printingSet} numberOfLines={1}>
        {printing.setCode.toUpperCase()}
      </Text>
      <Text variant="labelSmall" style={styles.printingMeta} numberOfLines={1}>
        #{printing.collectorNumber} · {printing.rarity[0]?.toUpperCase() ?? ''}
      </Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    scroll: { padding: spacing.xl, gap: spacing.md },
    loading: { marginTop: spacing.xxl },
    heroImage: { width: '100%', height: 480, borderRadius: radii.lg, backgroundColor: c.surface },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.sm },
    name: { fontWeight: '700', flexShrink: 1 },
    pt: { fontWeight: '600' },
    oracleBox: { ...cardSurface(c), marginTop: spacing.xs },
    oracleText: { lineHeight: 20 },
    printingsHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: spacing.md,
    },
    printingsTitle: { fontWeight: '700' },
    printingsCount: { color: c.textSubtle },
    printingsRow: { gap: 10, paddingVertical: spacing.xs },
    printingTile: { width: 96, gap: spacing.xs, alignItems: 'center' },
    printingThumb: { width: 96, height: 96, borderRadius: radii.md, backgroundColor: c.surface },
    printingSet: { fontWeight: '700' },
    printingMeta: { color: c.textMuted },
    error: { color: c.danger },
  });
