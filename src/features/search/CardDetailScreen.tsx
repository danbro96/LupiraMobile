import React, { memo, useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { ActivityIndicator, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  useGetCard,
  useListPrintings,
} from '../../api/generated/cards/cards';
import type { CardFaceDto, CardPrintingDto } from '../../api/generated/models';
import { MtgStackParamList } from '../../navigation/types';
import { cardSurface, radii, spacing, useColors, type Palette } from '../../ui/theme';
import { extraIdentity, ManaCost, SymbolText } from '../../ui/symbols';
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

  const renderPrinting = useCallback<ListRenderItem<CardPrintingDto>>(
    ({ item }) => (
      <PrintingTile
        printing={item}
        styles={styles}
        onPress={() => navigation.navigate('PrintingDetail', { oracleId: params.oracleId, printingId: item.id })}
      />
    ),
    [styles, navigation, params.oracleId],
  );

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
              <Image source={card.thumbnail.normal} style={styles.heroImage} contentFit="contain" transition={120} />
            ) : null}

            <View style={styles.titleRow}>
              <Text variant="headlineSmall" style={styles.name}>{card.name}</Text>
              <ManaCost cost={card.manaCost} size={20} />
            </View>

            <View style={styles.typeRow}>
              <Text variant="bodyMedium" style={styles.typeLine}>{card.typeLine}</Text>
              <ColorPips colors={extraIdentity(card.colorIdentity, card.manaCost)} />
            </View>

            {card.faces && card.faces.length > 1 ? (
              card.faces.map(face => <FaceBox key={face.faceIndex} face={face} styles={styles} />)
            ) : (
              <RulesBox oracleText={card.oracleText} power={card.power} toughness={card.toughness} styles={styles} />
            )}

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

            {/* Basic lands have hundreds of printings; recycle tiles instead of mounting every image. */}
            <FlashList
              horizontal
              data={printings}
              keyExtractor={p => p.id}
              renderItem={renderPrinting}
              ItemSeparatorComponent={PrintingGap}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.printingsRow}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function FaceBox({ face, styles }: { face: CardFaceDto; styles: Styles }) {
  return (
    <View style={styles.face}>
      <View style={styles.titleRow}>
        <Text variant="titleMedium" style={styles.name}>{face.name}</Text>
        <ManaCost cost={face.manaCost} />
      </View>
      {face.typeLine ? <Text variant="bodyMedium">{face.typeLine}</Text> : null}
      <RulesBox oracleText={face.oracleText} power={face.power} toughness={face.toughness} styles={styles} />
    </View>
  );
}

function RulesBox({
  oracleText,
  power,
  toughness,
  styles,
}: {
  oracleText: string | null;
  power: string | null;
  toughness: string | null;
  styles: Styles;
}) {
  if (!oracleText && !power && !toughness) return null;
  return (
    <View style={styles.oracleBox}>
      {oracleText ? <SymbolText text={oracleText} style={styles.oracleText} /> : null}
      {power || toughness ? (
        <Text variant="bodyMedium" style={styles.pt}>
          {power ?? '—'} / {toughness ?? '—'}
        </Text>
      ) : null}
    </View>
  );
}

const PrintingGap = () => <View style={{ width: 10 }} />;

const PrintingTile = memo(function PrintingTile({
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
        <Image source={thumb} recyclingKey={printing.id} style={styles.printingThumb} contentFit="cover" transition={120} />
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
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    scroll: { padding: spacing.xl, gap: spacing.md },
    loading: { marginTop: spacing.xxl },
    heroImage: { width: '100%', height: 480, borderRadius: radii.lg, backgroundColor: c.surface },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: spacing.sm },
    name: { fontWeight: '700', flexShrink: 1 },
    typeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    typeLine: { flexShrink: 1 },
    face: { gap: spacing.xs },
    pt: { fontWeight: '600', alignSelf: 'flex-end' },
    oracleBox: { ...cardSurface(c), marginTop: spacing.xs, gap: spacing.sm },
    oracleText: { lineHeight: 20 },
    printingsHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: spacing.md,
    },
    printingsTitle: { fontWeight: '700' },
    printingsCount: { color: c.textSubtle },
    printingsRow: { paddingVertical: spacing.xs },
    printingTile: { width: 96, gap: spacing.xs, alignItems: 'center' },
    printingThumb: { width: 96, height: 96, borderRadius: radii.md, backgroundColor: c.surface },
    printingSet: { fontWeight: '700' },
    printingMeta: { color: c.textMuted },
    error: { color: c.danger },
  });
