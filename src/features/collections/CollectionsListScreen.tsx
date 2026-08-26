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

type Nav = NativeStackNavigationProp<CollectionsStackParamList, 'Collections'>;

export function CollectionsListScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');

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
    onError: (e: Error) => Alert.alert('Create failed', e.message),
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Collections</Text>
      </View>

      <View style={styles.createRow}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder="New collection name"
          placeholderTextColor="#6e7686"
          style={styles.input}
          maxLength={64}
        />
        <Pressable
          onPress={() => create.mutate(newName.trim())}
          disabled={!newName.trim() || create.isPending}
          style={[
            styles.createButton,
            (!newName.trim() || create.isPending) && styles.disabled,
          ]}
        >
          {create.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createButtonText}>Create</Text>}
        </Pressable>
      </View>

      {collections.isError ? (
        <Text style={styles.errorText}>{(collections.error as Error).message}</Text>
      ) : null}

      <FlatList
        data={collections.data ?? []}
        keyExtractor={c => c.id}
        renderItem={({ item }) => (
          <Row
            collection={item}
            onPress={() => navigation.navigate('CollectionDetail', { collectionId: item.id })}
          />
        )}
        ListEmptyComponent={
          collections.isLoading ? (
            <ActivityIndicator style={styles.center} />
          ) : (
            <Text style={styles.emptyText}>No collections yet. Create one above or commit a scan selection.</Text>
          )
        }
        contentContainerStyle={styles.list}
        refreshing={collections.isFetching && !collections.isLoading}
        onRefresh={() => collections.refetch()}
      />
    </SafeAreaView>
  );
}

function Row({ collection, onPress }: { collection: CollectionDto; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
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
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '700' },
  createRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
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
  emptyText: { color: '#6e7686', fontSize: 14, textAlign: 'center', padding: 24 },
  errorText: { color: '#f97373', fontSize: 14, padding: 16 },
  center: { padding: 24, alignItems: 'center' },
});
