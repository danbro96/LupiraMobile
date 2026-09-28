import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  listCollections,
  createCollection,
} from '../../api/generated/collections/collections';
import type {
  CollectionDto,
} from '../../api/generated/models';
import { CollectionsStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { TextField } from '../../ui/components/TextField';
import { cardSurface, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';
import { toastError } from '../../feedback/toast';

type Nav = NativeStackNavigationProp<CollectionsStackParamList, 'Collections'>;

export function CollectionsListScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const collections = useQuery({
    queryKey: ['collections'],
    queryFn: () => listCollections(),
  });

  const create = useMutation<CollectionDto, Error, string>({
    mutationFn: (name: string) => createCollection({ name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      setNewName('');
    },
    onError: (e: Error) => toastError(`Create failed: ${e.message}`),
  });

  return (
    <View style={styles.container}>
      <View style={styles.createRow}>
        <TextField
          value={newName}
          onChangeText={setNewName}
          placeholder="New collection name"
          maxLength={64}
        />
        <Button
          title="Create"
          onPress={() => create.mutate(newName.trim())}
          disabled={!newName.trim()}
          loading={create.isPending}
          style={styles.createButton}
        />
      </View>

      {collections.isError ? (
        <Text variant="bodyMedium" style={styles.errorText}>{(collections.error as Error).message}</Text>
      ) : null}

      <FlatList
        data={collections.data ?? []}
        keyExtractor={col => col.id}
        renderItem={({ item }) => (
          <Row
            collection={item}
            styles={styles}
            palette={c}
            onPress={() => navigation.navigate('CollectionDetail', { collectionId: item.id })}
          />
        )}
        ListEmptyComponent={
          collections.isLoading ? (
            <ActivityIndicator style={styles.center} />
          ) : (
            <Text variant="bodyMedium" style={styles.emptyText}>No collections yet. Create one above or commit a scan selection.</Text>
          )
        }
        contentContainerStyle={styles.list}
        refreshing={collections.isFetching && !collections.isLoading}
        onRefresh={() => collections.refetch()}
      />
    </View>
  );
}

function Row({
  collection,
  styles,
  palette,
  onPress,
}: {
  collection: CollectionDto;
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.rowText}>
        <Text variant="titleMedium" style={styles.rowName}>{collection.name}</Text>
        <Text variant="bodySmall" style={styles.rowMeta}>{collection.cardCount} card(s)</Text>
      </View>
      <MaterialIcons name={ICONS.chevronRight} size={24} color={palette.textSubtle} />
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    createRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
    createButton: { justifyContent: 'center' },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
    row: { ...cardSurface(c), flexDirection: 'row', alignItems: 'center' },
    rowText: { flex: 1, gap: 2 },
    rowName: { color: c.text },
    rowMeta: { color: c.textMuted },
    emptyText: { color: c.textSubtle, textAlign: 'center', padding: spacing.xl },
    errorText: { color: c.danger, padding: spacing.lg },
    center: { padding: spacing.xl, alignItems: 'center' },
  });
