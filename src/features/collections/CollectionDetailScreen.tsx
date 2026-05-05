import React, { useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
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
import { CardInstanceResponse } from '../../api/mtg-types';
import { CollectionsStackParamList } from '../../navigation/types';
import { Icon } from '../../components/Icon';

type Nav = NativeStackNavigationProp<CollectionsStackParamList, 'CollectionDetail'>;
type Route = RouteProp<CollectionsStackParamList, 'CollectionDetail'>;

export function CollectionDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['collection', params.collectionId],
    queryFn: () => mtgApi.collections.get(params.collectionId),
  });

  const removeCard = useMutation({
    mutationFn: (instanceId: string) => mtgApi.collections.removeCard(params.collectionId, instanceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['collection', params.collectionId] });
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
      await queryClient.invalidateQueries({ queryKey: ['my-cards'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => mtgApi.collections.delete(params.collectionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
      await queryClient.invalidateQueries({ queryKey: ['my-cards'] });
      navigation.goBack();
    },
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      title: detail.data?.name ?? 'Collection',
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setRenameOpen(true)}>
            <Text style={styles.headerAction}>Rename</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              Alert.alert('Delete collection?', 'Cards in this collection will be unreachable. Continue?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
              ])
            }
          >
            <Text style={[styles.headerAction, { color: '#f97373' }]}>Delete</Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation, detail.data?.name, remove]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={detail.data?.cards ?? []}
        keyExtractor={c => c.instanceId}
        renderItem={({ item }) => (
          <CardRow
            card={item}
            onRemove={() =>
              Alert.alert('Remove card?', `Drop ${item.printing.name} from this collection?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => removeCard.mutate(item.instanceId) },
              ])
            }
          />
        )}
        ListEmptyComponent={
          detail.isLoading ? <ActivityIndicator style={styles.center} /> : <Text style={styles.emptyText}>No cards in this collection yet.</Text>
        }
        contentContainerStyle={styles.list}
        refreshing={detail.isFetching && !detail.isLoading}
        onRefresh={() => detail.refetch()}
      />

      <RenameModal
        open={renameOpen}
        currentName={detail.data?.name ?? ''}
        onClose={() => setRenameOpen(false)}
        onSubmit={async name => {
          await mtgApi.collections.rename(params.collectionId, { name });
          await queryClient.invalidateQueries({ queryKey: ['collection', params.collectionId] });
          await queryClient.invalidateQueries({ queryKey: ['collections'] });
          setRenameOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function CardRow({ card, onRemove }: { card: CardInstanceResponse; onRemove: () => void }) {
  const thumb = card.printing.images?.artCrop ?? card.printing.images?.normal ?? null;
  return (
    <View style={styles.row}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]} />
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{card.printing.name}</Text>
        <Text style={styles.rowMeta}>
          {card.printing.setCode.toUpperCase()} · #{card.printing.collectorNumber} · {card.condition}
          {card.foil ? ' · Foil' : ''}
        </Text>
      </View>
      <Pressable onPress={onRemove} style={styles.removeButton} hitSlop={6}>
        <Icon name="close-circle" size={22} color="destructive" />
      </Pressable>
    </View>
  );
}

function RenameModal({
  open,
  currentName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  currentName: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(currentName);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (open) setDraft(currentName);
  }, [open, currentName]);

  const submit = async () => {
    const name = draft.trim();
    if (!name || name === currentName) return;
    setBusy(true);
    try {
      await onSubmit(name);
    } catch (e: unknown) {
      Alert.alert('Rename failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Rename collection</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            style={styles.modalInput}
            maxLength={64}
            placeholder="Collection name"
            placeholderTextColor="#6e7686"
          />
          <View style={styles.modalActions}>
            <Pressable onPress={onClose} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={busy || !draft.trim() || draft.trim() === currentName}
              style={[
                styles.modalSubmit,
                (busy || !draft.trim() || draft.trim() === currentName) && styles.disabled,
              ]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  list: { padding: 16, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1f29',
    borderRadius: 8,
    padding: 8,
    gap: 12,
  },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: '#2c3340' },
  thumbPlaceholder: { backgroundColor: '#2c3340' },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  rowMeta: { color: '#9aa3b2', fontSize: 12 },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2c3340',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: { color: '#f97373', fontSize: 18, fontWeight: '700' },
  emptyText: { color: '#6e7686', fontSize: 14, textAlign: 'center', padding: 24 },
  center: { padding: 24, alignItems: 'center' },
  headerAction: { color: '#3b82f6', fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', backgroundColor: '#1a1f29', borderRadius: 12, padding: 20, gap: 12 },
  modalTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  modalInput: {
    backgroundColor: '#0e1117',
    color: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2c3340',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 14 },
  modalCancelText: { color: '#9aa3b2', fontWeight: '600' },
  modalSubmit: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 80,
    alignItems: 'center',
  },
  modalSubmitText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
