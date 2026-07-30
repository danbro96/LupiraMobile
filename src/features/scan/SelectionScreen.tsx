import React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  deleteSelectionsSelectionIdCardsInstanceId,
  getSelectionsSelectionId,
} from '../../api/generated/selections/selections';
import type { SelectionEntryResponse, SelectionResponse } from '../../api/generated/models';
import { useSelection } from '../../store/selection-store';
import { ScanStackParamList } from '../../navigation/types';
import { Icon } from '../../components/Icon';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'Selection'>;

export function SelectionScreen() {
  const navigation = useNavigation<Nav>();
  const currentSelectionId = useSelection(s => s.currentSelectionId);
  const setCurrent = useSelection(s => s.setCurrent);
  const queryClient = useQueryClient();

  const selection = useQuery({
    queryKey: ['selection', currentSelectionId],
    queryFn: async () => {
      const envelope = await getSelectionsSelectionId(currentSelectionId!);
      // Mutator throws on non-2xx — narrow off the void branch.
      return envelope.data as SelectionResponse;
    },
    enabled: !!currentSelectionId,
  });

  const removeCard = useMutation({
    mutationFn: (instanceId: string) =>
      deleteSelectionsSelectionIdCardsInstanceId(currentSelectionId!, instanceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['selection', currentSelectionId] }),
  });

  const cards = selection.data?.cards ?? [];
  const isEmpty = !currentSelectionId || cards.length === 0;

  if (!currentSelectionId) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Empty />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {selection.isLoading ? (
        <ActivityIndicator style={styles.center} />
      ) : null}

      {selection.isError ? (
        <Text style={styles.errorText}>{(selection.error as Error).message}</Text>
      ) : null}

      <FlatList
        data={cards}
        keyExtractor={c => c.instanceId}
        renderItem={({ item }) => (
          <EntryRow
            entry={item}
            onRemove={() => removeCard.mutate(item.instanceId)}
          />
        )}
        ListHeaderComponent={
          cards.length > 0 ? (
            <View style={styles.header}>
              <Text style={styles.title}>Selection</Text>
              <Text style={styles.subtitle}>
                {cards.length} card{cards.length === 1 ? '' : 's'} ready to commit
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={selection.isLoading ? null : <Empty />}
        contentContainerStyle={[styles.list, cards.length === 0 && styles.listEmpty]}
      />

      {!isEmpty ? (
        <View style={styles.footer}>
          <Pressable
            onPress={() =>
              Alert.alert(
                'Discard selection?',
                'This clears the current selection on this device. The cards stay in their existing collections (if any).',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Discard', style: 'destructive', onPress: () => setCurrent(null) },
                ],
              )
            }
            style={styles.discardButton}
            hitSlop={6}
          >
            <Icon name="trash-outline" size={16} color="destructive" />
            <Text style={styles.discardButtonText}>Discard</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('PickCollection', { selectionId: currentSelectionId })}
            style={styles.primaryButton}
          >
            <Icon name="checkmark-circle" size={18} color="white" />
            <Text style={styles.primaryButtonText}>Commit to collection</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function EntryRow({ entry, onRemove }: { entry: SelectionEntryResponse; onRemove: () => void }) {
  const thumb = entry.printing.images?.artCrop ?? entry.printing.images?.normal ?? null;
  return (
    <View style={styles.row}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]} />
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{entry.printing.name}</Text>
        <Text style={styles.rowMeta}>
          {entry.printing.setCode.toUpperCase()} · #{entry.printing.collectorNumber} · {entry.printing.rarity}
        </Text>
        <Text style={styles.rowConfidence}>confidence {entry.confidence.toFixed(2)}</Text>
      </View>
      <Pressable onPress={onRemove} style={styles.removeButton} hitSlop={6}>
        <Icon name="close-circle" size={22} color="destructive" />
      </Pressable>
    </View>
  );
}

function Empty() {
  return (
    <View style={styles.emptyWrap}>
      <Icon name="layers-outline" size={64} tint="#3a4252" />
      <Text style={styles.emptyTitle}>No cards yet</Text>
      <Text style={styles.emptyBody}>Scan some cards to build a selection.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  center: { padding: 24, alignItems: 'center' },
  header: { padding: 16, gap: 4 },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#9aa3b2', fontSize: 14 },
  list: { padding: 16, gap: 12 },
  listEmpty: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  row: {
    flexDirection: 'row',
    backgroundColor: '#1a1f29',
    borderRadius: 8,
    padding: 8,
    gap: 12,
    alignItems: 'center',
  },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: '#2c3340' },
  thumbPlaceholder: { backgroundColor: '#2c3340' },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  rowMeta: { color: '#9aa3b2', fontSize: 12 },
  rowConfidence: { color: '#6e7686', fontSize: 11, fontFamily: 'monospace' },
  removeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { color: '#f97373', fontSize: 14, padding: 16 },
  emptyWrap: { padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600', marginTop: 8 },
  emptyBody: { color: '#6e7686', fontSize: 14, textAlign: 'center' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    backgroundColor: '#0e1117',
    borderTopWidth: 1,
    borderTopColor: '#1a1f29',
  },
  discardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  discardButtonText: { color: '#f97373', fontSize: 14, fontWeight: '600' },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 12,
  },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
