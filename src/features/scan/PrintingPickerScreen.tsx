import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Searchbar, Text } from 'react-native-paper';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { listCards, useListPrintings } from '../../api/generated/cards/cards';
import type { CardDto, CardPrintingDto } from '../../api/generated/models';
import { ScanStackParamList } from '../../navigation/types';
import { useCurrentSelection } from './useCurrentSelection';
import { addEntry, DEFAULT_ATTRIBUTES, replaceEntries } from './selectionEdits';
import { cardSurface, radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';
import { toastError } from '../../feedback/toast';
import { hapticSuccess } from '../../feedback/haptics';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'PrintingPicker'>;
type Route = RouteProp<ScanStackParamList, 'PrintingPicker'>;
type Styles = ReturnType<typeof makeStyles>;

/** Scryfall `normal` images are 488×680. */
const CARD_ASPECT = 488 / 680;

/**
 * Manual match: search by name → pick the exact printing. Adds it to the selection, or swaps it in for
 * `replaceInstanceIds` (change printing). With `captureId`, hands the result back to the scan gallery.
 */
export function PrintingPickerScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const queryClient = useQueryClient();
  const { ensure } = useCurrentSelection();

  const [oracleId, setOracleId] = useState<string | null>(params.oracleId ?? null);
  const [query, setQuery] = useState(params.query ?? '');
  const debounced = useDebounced(query, 300);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: oracleId ? 'Pick printing' : 'Find card' });
  }, [navigation, oracleId]);

  const cards = useQuery({
    queryKey: ['cards', 'picker', debounced],
    queryFn: ({ signal }) => listCards({ q: debounced.trim(), take: 30 }, { signal }),
    enabled: !oracleId && debounced.trim().length > 1,
    placeholderData: keepPreviousData,
  });
  const printings = useListPrintings(oracleId ?? '', { query: { enabled: !!oracleId } });

  const pick = async (printing: CardPrintingDto) => {
    if (saving) return;
    setSaving(true);
    try {
      const selectionId = await ensure();
      const attrs = {
        isFoil: params.isFoil ?? DEFAULT_ATTRIBUTES.isFoil,
        condition: params.condition ?? DEFAULT_ATTRIBUTES.condition,
        language: params.language ?? DEFAULT_ATTRIBUTES.language,
      };
      const instanceIds = params.replaceInstanceIds?.length
        ? await replaceEntries(selectionId, params.replaceInstanceIds, printing.id, attrs)
        : [(await addEntry(selectionId, printing.id, attrs, { allowDuplicate: true })).instanceId];
      await queryClient.invalidateQueries({ queryKey: ['selection'] });
      hapticSuccess();
      if (params.captureId) {
        navigation.popTo('Scan', {
          manualMatch: { captureId: params.captureId, printingId: printing.id, instanceId: instanceIds[0] },
        });
      } else {
        navigation.goBack();
      }
    } catch (err: unknown) {
      toastError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (oracleId) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {!params.oracleId ? (
          <Pressable style={styles.back} onPress={() => setOracleId(null)}>
            <MaterialIcons name={ICONS.chevronLeft} size={20} color={c.primary} />
            <Text variant="labelLarge" style={styles.backText}>Search results</Text>
          </Pressable>
        ) : null}
        {printings.isLoading ? <ActivityIndicator style={styles.center} /> : null}
        <FlatList
          data={printings.data ?? []}
          keyExtractor={(p) => p.id}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <PrintingTile
              printing={item}
              current={item.id === params.currentPrintingId}
              disabled={saving}
              styles={styles}
              onPress={() => void pick(item)}
            />
          )}
        />
        {saving ? <ActivityIndicator style={styles.saving} /> : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Searchbar
        value={query}
        onChangeText={setQuery}
        placeholder="Card name"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={!params.query}
        style={styles.search}
      />
      <FlatList
        data={cards.data?.results ?? []}
        keyExtractor={(card) => card.oracleId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <CardRow card={item} styles={styles} onPress={() => setOracleId(item.oracleId)} />}
        ListEmptyComponent={
          cards.isFetching ? (
            <ActivityIndicator style={styles.center} />
          ) : (
            <Text variant="bodyMedium" style={styles.empty}>
              {debounced.trim().length > 1 ? 'No cards match that name.' : 'Type at least two letters.'}
            </Text>
          )
        }
      />
    </SafeAreaView>
  );
}

function CardRow({ card, styles, onPress }: { card: CardDto; styles: Styles; onPress: () => void }) {
  const thumb = card.thumbnail?.normal ?? card.thumbnail?.artCrop ?? null;
  return (
    <Pressable style={styles.row} onPress={onPress}>
      {thumb ? <Image source={thumb} style={styles.rowThumb} contentFit="cover" /> : <View style={styles.rowThumb} />}
      <View style={styles.rowText}>
        <Text variant="titleSmall" style={styles.rowName}>{card.name}</Text>
        <Text variant="bodySmall" style={styles.rowMeta} numberOfLines={1}>{card.typeLine}</Text>
        <Text variant="bodySmall" style={styles.rowMeta}>
          {card.printingCount} printing{card.printingCount === 1 ? '' : 's'}
        </Text>
      </View>
      <MaterialIcons name={ICONS.chevronRight} size={20} color={styles.rowMeta.color} />
    </Pressable>
  );
}

function PrintingTile({
  printing,
  current,
  disabled,
  styles,
  onPress,
}: {
  printing: CardPrintingDto;
  current: boolean;
  disabled: boolean;
  styles: Styles;
  onPress: () => void;
}) {
  const image = printing.images?.normal ?? null;
  return (
    <Pressable
      style={[styles.tile, current && styles.tileCurrent]}
      onPress={onPress}
      disabled={disabled || current}
      accessibilityLabel={`${printing.setName} ${printing.collectorNumber}${current ? ', current' : ''}`}
    >
      {image ? <Image source={image} style={styles.tileImage} contentFit="cover" transition={120} /> : <View style={styles.tileImage} />}
      <Text variant="labelMedium" style={styles.tileSet} numberOfLines={1}>{printing.setName}</Text>
      <Text variant="labelSmall" style={styles.tileMeta}>
        {current ? 'Current' : `${printing.setCode.toUpperCase()} #${printing.collectorNumber}`}
      </Text>
    </Pressable>
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    center: { padding: spacing.xl },
    saving: { position: 'absolute', alignSelf: 'center', top: '45%' },
    search: { margin: spacing.md },
    list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
    empty: { color: c.textSubtle, textAlign: 'center', padding: spacing.xl },
    row: { ...cardSurface(c), flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm },
    rowThumb: { width: 44, height: 44 / CARD_ASPECT, borderRadius: radii.sm, backgroundColor: c.border },
    rowText: { flex: 1, gap: 2 },
    rowName: { color: c.text },
    rowMeta: { color: c.textMuted },
    back: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md },
    backText: { color: c.primary },
    grid: { padding: spacing.md, gap: spacing.md },
    gridRow: { gap: spacing.md },
    tile: { flex: 1 / 3, gap: 2, borderRadius: radii.sm, padding: 2, borderWidth: 2, borderColor: 'transparent' },
    tileCurrent: { borderColor: c.primary },
    tileImage: { width: '100%', aspectRatio: CARD_ASPECT, borderRadius: radii.sm, backgroundColor: c.border },
    tileSet: { color: c.text },
    tileMeta: { color: c.textMuted },
  });
