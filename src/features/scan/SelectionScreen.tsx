import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button as PaperButton, Text } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { listCollections } from '../../api/generated/collections/collections';
import { useSelection } from '../../store/selection-store';
import { useCurrentSelectionQuery } from './useCurrentSelection';
import { useCommitSelection } from './useCommitSelection';
import { addEntry, removeEntries, replaceEntries } from './selectionEdits';
import {
  describeSummary,
  groupSelectionEntries,
  nextCondition,
  summariseSelection,
  type EntryAttributes,
  type SelectionGroup,
} from './selectionGroups';
import { ScanStackParamList } from '../../navigation/types';
import { useConfirm } from '../../ui/components/ConfirmDialog';
import { HIT_SLOP, cardSurface, radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';
import { toast, toastError } from '../../feedback/toast';
import { hapticSelection } from '../../feedback/haptics';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'Selection'>;
type Styles = ReturnType<typeof makeStyles>;

/** Scryfall `normal` images are 488×680. */
const CARD_ASPECT = 488 / 680;

export function SelectionScreen() {
  const navigation = useNavigation<Nav>();
  const currentSelectionId = useSelection(s => s.currentSelectionId);
  const setCurrent = useSelection(s => s.setCurrent);
  const lastCollectionId = useSelection(s => s.lastCollectionId);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const selection = useCurrentSelectionQuery(currentSelectionId);
  const collections = useQuery({ queryKey: ['collections'], queryFn: () => listCollections() });
  const defaultCollection = collections.data?.find(col => col.id === lastCollectionId) ?? null;
  const commit = useCommitSelection(currentSelectionId, () => navigation.popTo('Scan'));

  const entries = useMemo(() => selection.data?.cards ?? [], [selection.data]);
  const groups = useMemo(() => groupSelectionEntries(entries), [entries]);
  const summary = useMemo(() => summariseSelection(entries), [entries]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const edit = useCallback(
    async (key: string, action: (selectionId: string) => Promise<unknown>) => {
      if (!currentSelectionId) return;
      setBusyKey(key);
      try {
        await action(currentSelectionId);
      } catch (err: unknown) {
        toastError((err as Error).message);
      } finally {
        await queryClient.invalidateQueries({ queryKey: ['selection', currentSelectionId] });
        setBusyKey(null);
      }
    },
    [currentSelectionId, queryClient],
  );

  const setAttributes = (group: SelectionGroup, attrs: EntryAttributes) => {
    hapticSelection();
    void edit(group.key, id => replaceEntries(id, group.instanceIds, group.printing.id, attrs));
  };

  const increment = (group: SelectionGroup) =>
    void edit(group.key, id => addEntry(id, group.printing.id, group, { allowDuplicate: true }));

  const decrement = (group: SelectionGroup) => {
    const last = group.instanceIds[group.instanceIds.length - 1];
    void edit(group.key, async id => {
      await removeEntries(id, [last]);
      if (group.instanceIds.length === 1) {
        toast(`Removed ${group.printing.name}`, {
          action: {
            label: 'Undo',
            onPress: () => void edit(group.key, sid => addEntry(sid, group.printing.id, group, { allowDuplicate: true })),
          },
        });
      }
    });
  };

  const changePrinting = (group: SelectionGroup) =>
    navigation.navigate('PrintingPicker', {
      oracleId: group.printing.oracleId,
      replaceInstanceIds: group.instanceIds,
      currentPrintingId: group.printing.id,
      isFoil: group.isFoil,
      condition: group.condition,
      language: group.language,
    });

  if (!currentSelectionId) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Empty styles={styles} palette={c} />
      </SafeAreaView>
    );
  }

  const isEmpty = entries.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {selection.isLoading ? <ActivityIndicator style={styles.center} /> : null}

      {selection.isError ? (
        <Text variant="bodyMedium" style={styles.errorText}>{(selection.error as Error).message}</Text>
      ) : null}

      <FlatList
        data={groups}
        keyExtractor={g => g.key}
        renderItem={({ item }) => (
          <GroupRow
            group={item}
            busy={busyKey === item.key}
            styles={styles}
            palette={c}
            onChangePrinting={() => changePrinting(item)}
            onToggleFoil={() => setAttributes(item, { ...item, isFoil: !item.isFoil })}
            onCycleCondition={() => setAttributes(item, { ...item, condition: nextCondition(item.condition) })}
            onIncrement={() => increment(item)}
            onDecrement={() => decrement(item)}
          />
        )}
        ListHeaderComponent={
          !isEmpty ? (
            <View style={styles.header}>
              <Text variant="titleMedium" style={styles.title}>
                {describeSummary(summary)}
                {summary.valueEur != null ? ` · €${summary.valueEur.toFixed(2)}` : ''}
              </Text>
              <Text variant="bodySmall" style={styles.subtitle}>Tap a card to change its printing.</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={selection.isLoading ? null : <Empty styles={styles} palette={c} />}
        contentContainerStyle={[styles.list, isEmpty && styles.listEmpty]}
      />

      {!isEmpty ? (
        <View style={styles.footer}>
          <PaperButton
            mode="contained"
            icon={ICONS.checkCircle}
            loading={commit.isPending}
            disabled={commit.isPending || busyKey != null}
            onPress={() =>
              defaultCollection
                ? commit.mutate(defaultCollection.id)
                : navigation.navigate('PickCollection', { selectionId: currentSelectionId })
            }
            contentStyle={styles.primaryContent}
          >
            {defaultCollection ? `Add ${describeSummary(summary)} to ${defaultCollection.name}` : 'Choose collection'}
          </PaperButton>
          <View style={styles.footerRow}>
            <PaperButton
              mode="text"
              icon={ICONS.delete}
              textColor={c.danger}
              disabled={commit.isPending}
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
            {defaultCollection ? (
              <PaperButton
                mode="text"
                icon={ICONS.folder}
                disabled={commit.isPending}
                onPress={() => navigation.navigate('PickCollection', { selectionId: currentSelectionId })}
              >
                Other collection
              </PaperButton>
            ) : null}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function GroupRow({
  group,
  busy,
  styles,
  palette,
  onChangePrinting,
  onToggleFoil,
  onCycleCondition,
  onIncrement,
  onDecrement,
}: {
  group: SelectionGroup;
  busy: boolean;
  styles: Styles;
  palette: Palette;
  onChangePrinting: () => void;
  onToggleFoil: () => void;
  onCycleCondition: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const { printing } = group;
  const thumb = printing.images?.normal ?? printing.images?.artCrop ?? null;
  const qty = group.instanceIds.length;
  return (
    <View style={[styles.row, busy && styles.busy]}>
      <Pressable style={styles.rowMain} onPress={onChangePrinting} disabled={busy} accessibilityLabel={`${printing.name}, change printing`}>
        {thumb ? <Image source={{ uri: thumb }} style={styles.thumb} /> : <View style={styles.thumb} />}
        <View style={styles.rowText}>
          <Text variant="titleSmall" style={styles.rowName} numberOfLines={1}>{printing.name}</Text>
          <Text variant="bodySmall" style={styles.rowMeta} numberOfLines={1}>
            {printing.setName} · {printing.setCode.toUpperCase()} #{printing.collectorNumber}
          </Text>
          <View style={styles.chips}>
            <Pressable
              onPress={onToggleFoil}
              disabled={busy}
              hitSlop={HIT_SLOP}
              style={[styles.chip, group.isFoil && styles.chipOn]}
              accessibilityLabel={group.isFoil ? 'Foil, tap for non-foil' : 'Non-foil, tap for foil'}
            >
              <MaterialIcons name={ICONS.foil} size={14} color={group.isFoil ? palette.onPrimary : palette.textMuted} />
              <Text style={[styles.chipText, group.isFoil && styles.chipTextOn]}>Foil</Text>
            </Pressable>
            <Pressable
              onPress={onCycleCondition}
              disabled={busy}
              hitSlop={HIT_SLOP}
              style={styles.chip}
              accessibilityLabel={`Condition ${group.condition}, tap to change`}
            >
              <Text style={styles.chipText}>{group.condition}</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
      <View style={styles.stepper}>
        <Pressable onPress={onIncrement} disabled={busy} hitSlop={HIT_SLOP} style={styles.stepButton} accessibilityLabel="Add a copy">
          <MaterialIcons name={ICONS.add} size={20} color={palette.text} />
        </Pressable>
        {busy ? <ActivityIndicator size={14} /> : <Text style={styles.qty}>{qty}</Text>}
        <Pressable
          onPress={onDecrement}
          disabled={busy}
          hitSlop={HIT_SLOP}
          style={styles.stepButton}
          accessibilityLabel={qty === 1 ? 'Remove card' : 'Remove a copy'}
        >
          <MaterialIcons name={qty === 1 ? ICONS.delete : ICONS.remove} size={20} color={qty === 1 ? palette.danger : palette.text} />
        </Pressable>
      </View>
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
    header: { paddingBottom: spacing.sm, gap: spacing.xs },
    title: { color: c.text, fontWeight: '700' },
    subtitle: { color: c.textMuted },
    list: { padding: spacing.lg, gap: spacing.md },
    listEmpty: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
    row: {
      ...cardSurface(c),
      flexDirection: 'row',
      padding: spacing.sm,
      gap: spacing.sm,
      alignItems: 'center',
    },
    busy: { opacity: 0.6 },
    rowMain: { flex: 1, flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
    thumb: { width: 52, height: 52 / CARD_ASPECT, borderRadius: radii.sm, backgroundColor: c.border },
    rowText: { flex: 1, gap: 2 },
    rowName: { color: c.text },
    rowMeta: { color: c.textMuted },
    chips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipOn: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { color: c.textMuted, fontSize: 12, fontWeight: '600' },
    chipTextOn: { color: c.onPrimary },
    stepper: { alignItems: 'center', gap: 2 },
    stepButton: { width: 36, height: 32, alignItems: 'center', justifyContent: 'center' },
    qty: { color: c.text, fontSize: 16, fontWeight: '700', minWidth: 20, textAlign: 'center' },
    errorText: { color: c.danger, padding: spacing.lg },
    emptyWrap: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
    emptyTitle: { color: c.text, marginTop: spacing.sm },
    emptyBody: { color: c.textSubtle, textAlign: 'center' },
    footer: {
      padding: spacing.lg,
      paddingBottom: spacing.sm,
      gap: spacing.xs,
      backgroundColor: c.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
    },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
    primaryContent: { paddingVertical: spacing.xs },
  });
