import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button as PaperButton, Text, TextInput } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { listCollections, createCollection } from '../../api/generated/collections/collections';
import type { CollectionDto } from '../../api/generated/models';
import { useSelection } from '../../store/selection-store';
import { ScanStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { TextField } from '../../ui/components/TextField';
import { cardSurface, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';
import { toastError } from '../../feedback/toast';
import { hapticSelection } from '../../feedback/haptics';
import { useCurrentSelectionQuery } from './useCurrentSelection';
import { useCommitSelection } from './useCommitSelection';
import { describeSummary, summariseSelection } from './selectionGroups';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'PickCollection'>;
type Route = RouteProp<ScanStackParamList, 'PickCollection'>;
type Styles = ReturnType<typeof makeStyles>;

export function PickCollectionScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const lastCollectionId = useSelection(s => s.lastCollectionId);
  const queryClient = useQueryClient();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [newName, setNewName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(lastCollectionId);

  const collections = useQuery({ queryKey: ['collections'], queryFn: () => listCollections() });
  const selection = useCurrentSelectionQuery(params.selectionId);
  const summary = useMemo(() => summariseSelection(selection.data?.cards ?? []), [selection.data]);
  const target = collections.data?.find(col => col.id === selectedId) ?? null;

  const create = useMutation({
    mutationFn: (name: string) => createCollection({ name }),
    onSuccess: async created => {
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
      setNewName('');
      setSelectedId(created.id);
    },
    onError: e => toastError(`Create failed: ${(e as Error).message}`),
  });

  const commit = useCommitSelection(params.selectionId, () => navigation.popTo('Scan'));

  const onCreate = () => {
    const name = newName.trim();
    if (name) create.mutate(name);
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.createBlock}>
        <View style={styles.createRow}>
          <TextField
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={onCreate}
            placeholder="New collection name"
            maxLength={64}
            returnKeyType="done"
            left={<TextInput.Icon icon={ICONS.add} />}
          />
          <Button title="Create" variant="secondary" onPress={onCreate} disabled={!newName.trim()} loading={create.isPending} />
        </View>
      </View>

      {collections.isLoading ? <ActivityIndicator style={styles.center} /> : null}

      <FlatList
        data={collections.data ?? []}
        keyExtractor={col => col.id}
        renderItem={({ item }) => (
          <CollectionRow
            collection={item}
            selected={item.id === selectedId}
            styles={styles}
            palette={c}
            onPress={() => {
              hapticSelection();
              setSelectedId(item.id);
            }}
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          collections.isLoading ? null : (
            <Text variant="bodyMedium" style={styles.emptyText}>No collections yet — create one above.</Text>
          )
        }
      />

      <View style={styles.footer}>
        <PaperButton
          mode="contained"
          icon={ICONS.checkCircle}
          disabled={!target || commit.isPending || summary.cards === 0}
          loading={commit.isPending}
          onPress={() => target && commit.mutate(target.id)}
          contentStyle={styles.primaryContent}
        >
          {target ? `Add ${describeSummary(summary)} to ${target.name}` : 'Select a collection'}
        </PaperButton>
      </View>
    </SafeAreaView>
  );
}

function CollectionRow({
  collection,
  selected,
  styles,
  palette,
  onPress,
}: {
  collection: CollectionDto;
  selected: boolean;
  styles: Styles;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, selected && styles.rowSelected]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <MaterialIcons
        name={selected ? ICONS.radioOn : ICONS.radioOff}
        size={22}
        color={selected ? palette.primary : palette.textMuted}
      />
      <View style={styles.rowText}>
        <Text variant="titleMedium" style={styles.rowName}>{collection.name}</Text>
        <Text variant="bodySmall" style={styles.rowMeta}>
          {collection.cardCount} card{collection.cardCount === 1 ? '' : 's'}
        </Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    createBlock: { padding: spacing.lg, paddingBottom: spacing.md },
    createRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    center: { padding: spacing.xl, alignItems: 'center' },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
    row: {
      ...cardSurface(c),
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    rowSelected: { borderColor: c.primary },
    rowText: { flex: 1, gap: 2 },
    rowName: { color: c.text },
    rowMeta: { color: c.textMuted },
    emptyText: { color: c.textSubtle, textAlign: 'center', padding: spacing.lg },
    footer: {
      padding: spacing.lg,
      backgroundColor: c.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
    },
    primaryContent: { paddingVertical: spacing.xs },
  });
