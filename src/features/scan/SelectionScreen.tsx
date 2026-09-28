import React, { useMemo } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button as PaperButton, Text } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { deleteSelectionCard } from '../../api/generated/selections/selections';
import type { SelectionEntryDto } from '../../api/generated/models';
import { useSelection } from '../../store/selection-store';
import { useCurrentSelectionQuery } from './useCurrentSelection';
import { ScanStackParamList } from '../../navigation/types';
import { useConfirm } from '../../ui/components/ConfirmDialog';
import { HIT_SLOP, cardSurface, radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'Selection'>;
type Styles = ReturnType<typeof makeStyles>;

export function SelectionScreen() {
  const navigation = useNavigation<Nav>();
  const currentSelectionId = useSelection(s => s.currentSelectionId);
  const setCurrent = useSelection(s => s.setCurrent);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const selection = useCurrentSelectionQuery(currentSelectionId);

  const removeCard = useMutation({
    mutationFn: (instanceId: string) =>
      deleteSelectionCard(currentSelectionId!, instanceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['selection', currentSelectionId] }),
  });

  const cards = selection.data?.cards ?? [];
  const isEmpty = !currentSelectionId || cards.length === 0;

  if (!currentSelectionId) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Empty styles={styles} palette={c} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {selection.isLoading ? (
        <ActivityIndicator style={styles.center} />
      ) : null}

      {selection.isError ? (
        <Text variant="bodyMedium" style={styles.errorText}>{(selection.error as Error).message}</Text>
      ) : null}

      <FlatList
        data={cards}
        keyExtractor={card => card.instanceId}
        renderItem={({ item }) => (
          <EntryRow
            entry={item}
            styles={styles}
            palette={c}
            onRemove={() => removeCard.mutate(item.instanceId)}
          />
        )}
        ListHeaderComponent={
          cards.length > 0 ? (
            <View style={styles.header}>
              <Text variant="headlineMedium" style={styles.title}>Selection</Text>
              <Text variant="bodyMedium" style={styles.subtitle}>
                {cards.length} card{cards.length === 1 ? '' : 's'} ready to commit
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={selection.isLoading ? null : <Empty styles={styles} palette={c} />}
        contentContainerStyle={[styles.list, cards.length === 0 && styles.listEmpty]}
      />

      {!isEmpty ? (
        <View style={styles.footer}>
          <PaperButton
            mode="text"
            icon={ICONS.delete}
            textColor={c.danger}
            onPress={async () => {
              const ok = await confirm({
                title: 'Discard selection?',
                message: 'This clears the current selection on this device. The cards stay in their existing collections (if any).',
                confirmLabel: 'Discard',
                destructive: true,
              });
              if (ok) void setCurrent(null);
            }}
          >
            Discard
          </PaperButton>
          <PaperButton
            mode="contained"
            icon={ICONS.checkCircle}
            onPress={() => navigation.navigate('PickCollection', { selectionId: currentSelectionId })}
            style={styles.primaryButton}
          >
            Commit to collection
          </PaperButton>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function EntryRow({
  entry,
  styles,
  palette,
  onRemove,
}: {
  entry: SelectionEntryDto;
  styles: Styles;
  palette: Palette;
  onRemove: () => void;
}) {
  const thumb = entry.printing.images?.artCrop ?? entry.printing.images?.normal ?? null;
  return (
    <View style={styles.row}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={styles.thumb} />
      )}
      <View style={styles.rowText}>
        <Text variant="titleSmall" style={styles.rowName}>{entry.printing.name}</Text>
        <Text variant="bodySmall" style={styles.rowMeta}>
          {entry.printing.setCode.toUpperCase()} · #{entry.printing.collectorNumber} · {entry.printing.rarity}
        </Text>
        <Text variant="labelSmall" style={styles.rowConfidence}>confidence {entry.confidence.toFixed(2)}</Text>
      </View>
      <Pressable onPress={onRemove} style={styles.removeButton} hitSlop={HIT_SLOP}>
        <MaterialIcons name={ICONS.cancel} size={22} color={palette.danger} />
      </Pressable>
    </View>
  );
}

function Empty({ styles, palette }: { styles: Styles; palette: Palette }) {
  return (
    <View style={styles.emptyWrap}>
      <MaterialIcons name={ICONS.layers} size={64} color={palette.textDisabled} />
      <Text variant="titleMedium" style={styles.emptyTitle}>No cards yet</Text>
      <Text variant="bodyMedium" style={styles.emptyBody}>Scan some cards to build a selection.</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    center: { padding: spacing.xl, alignItems: 'center' },
    header: { padding: spacing.lg, gap: spacing.xs },
    title: { color: c.text, fontWeight: '700' },
    subtitle: { color: c.textMuted },
    list: { padding: spacing.lg, gap: spacing.md },
    listEmpty: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
    row: {
      ...cardSurface(c),
      flexDirection: 'row',
      padding: spacing.sm,
      gap: spacing.md,
      alignItems: 'center',
    },
    thumb: { width: 56, height: 56, borderRadius: radii.sm, backgroundColor: c.border },
    rowText: { flex: 1, gap: 2 },
    rowName: { color: c.text },
    rowMeta: { color: c.textMuted },
    rowConfidence: { color: c.textSubtle, fontFamily: 'monospace' },
    removeButton: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorText: { color: c.danger, padding: spacing.lg },
    emptyWrap: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
    emptyTitle: { color: c.text, marginTop: spacing.sm },
    emptyBody: { color: c.textSubtle, textAlign: 'center' },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.lg,
      gap: spacing.md,
      backgroundColor: c.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
    },
    primaryButton: { flex: 1 },
  });
