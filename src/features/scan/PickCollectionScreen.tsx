import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text, TextInput } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  listCollections,
  createCollection,
} from '../../api/generated/collections/collections';
import { commitSelection } from '../../api/generated/selections/selections';
import type {
  CollectionDto,
  CommitSelectionResponse,
} from '../../api/generated/models';
import { useSelection } from '../../store/selection-store';
import { ScanStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { TextField } from '../../ui/components/TextField';
import { cardSurface, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';
import { toast, toastError } from '../../feedback/toast';
import { hapticSuccess } from '../../feedback/haptics';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'PickCollection'>;
type Route = RouteProp<ScanStackParamList, 'PickCollection'>;

const ARM_TIMEOUT_MS = 5000;

export function PickCollectionScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const setCurrent = useSelection(s => s.setCurrent);
  const queryClient = useQueryClient();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [newName, setNewName] = useState('');
  /** Two-tap-to-commit gate: id of the row that's "armed" awaiting confirmation. */
  const [armedId, setArmedId] = useState<string | null>(null);

  const collections = useQuery({
    queryKey: ['collections'],
    queryFn: () => listCollections(),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createCollection({ name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      setNewName('');
    },
  });

  const commit = useMutation<CommitSelectionResponse, Error, string>({
    mutationFn: (collectionId: string) =>
      commitSelection(params.selectionId, { collectionId }),
    onSuccess: async result => {
      if (result.remainingCount === 0) {
        await setCurrent(null);
      }

      await queryClient.invalidateQueries({ queryKey: ['selection'] });
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
      await queryClient.invalidateQueries({ queryKey: ['collection', result.collectionId] });
      await queryClient.invalidateQueries({ queryKey: ['my-cards'] });

      hapticSuccess();
      toast(`Added ${result.addedCount} card(s) to "${result.collectionName}".`);
      navigation.goBack();
    },
  });

  // Auto-disarm after 5 seconds of inactivity so a forgotten armed state can't
  // commit on a stray later tap when the user has stopped paying attention.
  useEffect(() => {
    if (!armedId) return;
    const t = setTimeout(() => setArmedId(null), ARM_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [armedId]);

  const onCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createMutation.mutateAsync(name);
      commit.mutate(created.id);
    } catch (e: unknown) {
      toastError(`Create failed: ${(e as Error).message}`);
    }
  };

  const onRowPress = (id: string) => {
    if (armedId === id) {
      commit.mutate(id);
      setArmedId(null);
    } else {
      setArmedId(id);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>Choose a collection</Text>
        <Text variant="bodySmall" style={styles.subtitle}>Tap a collection, then tap again to commit.</Text>
      </View>

      <View style={styles.createBlock}>
        <Text variant="bodyMedium" style={styles.label}>Or create a new one</Text>
        <View style={styles.createRow}>
          <TextField
            value={newName}
            onChangeText={setNewName}
            placeholder="Collection name"
            maxLength={64}
            left={<TextInput.Icon icon={ICONS.add} />}
          />
          <Button
            title="Create"
            onPress={onCreate}
            disabled={!newName.trim()}
            loading={createMutation.isPending || commit.isPending}
          />
        </View>
      </View>

      {collections.isLoading ? <ActivityIndicator style={styles.center} /> : null}

      <FlatList
        data={collections.data ?? []}
        keyExtractor={col => col.id}
        renderItem={({ item }) => (
          <CollectionRow
            collection={item}
            armed={armedId === item.id}
            disabled={commit.isPending}
            styles={styles}
            palette={c}
            onPress={() => onRowPress(item.id)}
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          collections.isLoading ? null : (
            <Text variant="bodyMedium" style={styles.emptyText}>No collections yet — create one above.</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

function CollectionRow({
  collection,
  armed,
  disabled,
  styles,
  palette,
  onPress,
}: {
  collection: CollectionDto;
  armed: boolean;
  disabled: boolean;
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.row, armed && styles.rowArmed, disabled && styles.disabled]}
    >
      <MaterialIcons
        name={armed ? ICONS.folderOpen : ICONS.folder}
        size={20}
        color={armed ? palette.primary : palette.textMuted}
      />
      <View style={styles.rowText}>
        <Text variant="titleMedium" style={styles.rowName}>{collection.name}</Text>
        {armed ? (
          <Text variant="labelMedium" style={styles.rowArmedHint}>Tap again to commit</Text>
        ) : (
          <Text variant="bodySmall" style={styles.rowMeta}>
            {collection.cardCount} card{collection.cardCount === 1 ? '' : 's'}
          </Text>
        )}
      </View>
      <MaterialIcons
        name={armed ? ICONS.checkCircle : ICONS.chevronRight}
        size={20}
        color={armed ? palette.primary : palette.textSubtle}
      />
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    header: { padding: spacing.lg, gap: spacing.xs },
    title: { color: c.text, fontWeight: '700' },
    subtitle: { color: c.textMuted },
    createBlock: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
    label: { color: c.textMuted },
    createRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    disabled: { opacity: 0.5 },
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
    rowArmed: { borderColor: c.primary, backgroundColor: c.border },
    rowText: { flex: 1, gap: 2 },
    rowName: { color: c.text },
    rowMeta: { color: c.textMuted },
    rowArmedHint: { color: c.primary },
    emptyText: { color: c.textSubtle, textAlign: 'center', padding: spacing.lg },
  });
