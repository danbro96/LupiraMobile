import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { mtgApi } from '../../api/mtg-client';
import { CollectionResponse } from '../../api/mtg-types';
import { useSelection } from '../../store/selection-store';
import { ScanStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'PickCollection'>;
type Route = RouteProp<ScanStackParamList, 'PickCollection'>;

export function PickCollectionScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const setCurrent = useSelection(s => s.setCurrent);
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState('');

  const collections = useQuery({
    queryKey: ['collections'],
    queryFn: () => mtgApi.collections.list(),
  });

  const createCollection = useMutation({
    mutationFn: (name: string) => mtgApi.collections.create({ name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      setNewName('');
    },
  });

  const commit = useMutation({
    mutationFn: (collectionId: string) =>
      mtgApi.selections.commit(params.selectionId, { collectionId }),
    onSuccess: async result => {
      if (result.remainingCount === 0) {
        await setCurrent(null);
      }

      await queryClient.invalidateQueries({ queryKey: ['selection'] });
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
      await queryClient.invalidateQueries({ queryKey: ['collection', result.collectionId] });
      await queryClient.invalidateQueries({ queryKey: ['my-cards'] });

      Alert.alert('Committed', `Added ${result.addedCount} card(s) to "${result.collectionName}".`);
      navigation.goBack();
    },
  });

  const onCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createCollection.mutateAsync(name);
      commit.mutate(created.id);
    } catch (e: unknown) {
      Alert.alert('Create failed', (e as Error).message);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose a collection</Text>
      </View>

      <View style={styles.createBlock}>
        <Text style={styles.label}>Or create a new one</Text>
        <View style={styles.createRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Collection name"
            placeholderTextColor="#6e7686"
            style={styles.input}
            maxLength={64}
          />
          <Pressable
            onPress={onCreate}
            disabled={!newName.trim() || createCollection.isPending || commit.isPending}
            style={[
              styles.createButton,
              (!newName.trim() || createCollection.isPending || commit.isPending) && styles.disabled,
            ]}
          >
            {createCollection.isPending || commit.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.createButtonText}>Create &amp; commit</Text>
            )}
          </Pressable>
        </View>
      </View>

      {collections.isLoading ? <ActivityIndicator style={styles.center} /> : null}

      <FlatList
        data={collections.data?.collections ?? []}
        keyExtractor={c => c.id}
        renderItem={({ item }) => (
          <CollectionRow
            collection={item}
            disabled={commit.isPending}
            onPress={() => commit.mutate(item.id)}
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          collections.isLoading ? null : (
            <Text style={styles.emptyText}>No collections yet — create one above.</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

function CollectionRow({
  collection,
  disabled,
  onPress,
}: {
  collection: CollectionResponse;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.row, disabled && styles.disabled]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{collection.name}</Text>
        <Text style={styles.rowMeta}>{collection.cardCount} card(s)</Text>
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  header: { padding: 16 },
  title: { color: '#f5f5f5', fontSize: 24, fontWeight: '700' },
  createBlock: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  label: { color: '#9aa3b2', fontSize: 14 },
  createRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#1a1f29',
    color: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2c3340',
  },
  createButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  createButtonText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  center: { padding: 24, alignItems: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1f29',
    borderRadius: 8,
    padding: 14,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  rowMeta: { color: '#9aa3b2', fontSize: 12 },
  rowChevron: { color: '#6e7686', fontSize: 24 },
  emptyText: { color: '#6e7686', fontSize: 14, textAlign: 'center', padding: 16 },
});
