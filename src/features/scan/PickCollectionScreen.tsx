import React, { useEffect, useState } from 'react';
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
import {
  getCollections,
  postCollections,
} from '../../api/generated/collections/collections';
import { postSelectionsSelectionIdCommit } from '../../api/generated/selections/selections';
import type {
  CollectionResponse,
  CommitSelectionResponse,
} from '../../api/generated/models';
import { useSelection } from '../../store/selection-store';
import { ScanStackParamList } from '../../navigation/types';
import { Icon } from '../../components/Icon';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'PickCollection'>;
type Route = RouteProp<ScanStackParamList, 'PickCollection'>;

const ARM_TIMEOUT_MS = 5000;

export function PickCollectionScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const setCurrent = useSelection(s => s.setCurrent);
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState('');
  /** Two-tap-to-commit gate: id of the row that's "armed" awaiting confirmation. */
  const [armedId, setArmedId] = useState<string | null>(null);

  const collections = useQuery({
    queryKey: ['collections'],
    queryFn: () => getCollections(),
  });

  const createCollection = useMutation({
    mutationFn: (name: string) => postCollections({ name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      setNewName('');
    },
  });

  const commit = useMutation<CommitSelectionResponse, Error, string>({
    mutationFn: (collectionId: string) =>
      postSelectionsSelectionIdCommit(params.selectionId, { collectionId }),
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
      const created = await createCollection.mutateAsync(name);
      commit.mutate(created.id);
    } catch (e: unknown) {
      Alert.alert('Create failed', (e as Error).message);
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
        <Text style={styles.title}>Choose a collection</Text>
        <Text style={styles.subtitle}>Tap a collection, then tap again to commit.</Text>
      </View>

      <View style={styles.createBlock}>
        <Text style={styles.label}>Or create a new one</Text>
        <View style={styles.createRow}>
          <View style={styles.inputWrap}>
            <Icon name="add" size={18} color="muted" />
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Collection name"
              placeholderTextColor="#6e7686"
              style={styles.input}
              maxLength={64}
            />
          </View>
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
              <Text style={styles.createButtonText}>Create</Text>
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
            armed={armedId === item.id}
            disabled={commit.isPending}
            onPress={() => onRowPress(item.id)}
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
  armed,
  disabled,
  onPress,
}: {
  collection: CollectionResponse;
  armed: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.row, armed && styles.rowArmed, disabled && styles.disabled]}
    >
      <Icon name={armed ? 'folder-open' : 'folder-outline'} size={20} color={armed ? 'primary' : 'muted'} />
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{collection.name}</Text>
        {armed ? (
          <Text style={styles.rowArmedHint}>Tap again to commit</Text>
        ) : (
          <Text style={styles.rowMeta}>
            {collection.cardCount} card{collection.cardCount === 1 ? '' : 's'}
          </Text>
        )}
      </View>
      <Icon name={armed ? 'checkmark-circle' : 'chevron-forward'} size={20} color={armed ? 'primary' : 'faint'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  header: { padding: 16, gap: 4 },
  title: { color: '#f5f5f5', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#9aa3b2', fontSize: 13 },
  createBlock: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  label: { color: '#9aa3b2', fontSize: 14 },
  createRow: { flexDirection: 'row', gap: 8 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1a1f29',
    borderRadius: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#2c3340',
  },
  input: {
    flex: 1,
    color: '#f5f5f5',
    paddingVertical: 10,
    fontSize: 16,
  },
  createButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  center: { padding: 24, alignItems: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1a1f29',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowArmed: { borderColor: '#3b82f6', backgroundColor: '#1c2433' },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  rowMeta: { color: '#9aa3b2', fontSize: 12 },
  rowArmedHint: { color: '#3b82f6', fontSize: 12, fontWeight: '600' },
  emptyText: { color: '#6e7686', fontSize: 14, textAlign: 'center', padding: 16 },
});
