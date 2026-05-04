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
import { mtgApi } from '../../api/mtg-client';
import { SelectionEntryResponse } from '../../api/mtg-types';
import { useSelection } from '../../store/selection-store';
import { ScanStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'Selection'>;

export function SelectionScreen() {
  const navigation = useNavigation<Nav>();
  const currentSelectionId = useSelection(s => s.currentSelectionId);
  const setCurrent = useSelection(s => s.setCurrent);
  const queryClient = useQueryClient();

  const selection = useQuery({
    queryKey: ['selection', currentSelectionId],
    queryFn: () => mtgApi.selections.get(currentSelectionId!),
    enabled: !!currentSelectionId,
  });

  const removeCard = useMutation({
    mutationFn: (instanceId: string) => mtgApi.selections.removeCard(currentSelectionId!, instanceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['selection', currentSelectionId] }),
  });

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
        data={selection.data?.cards ?? []}
        keyExtractor={c => c.instanceId}
        renderItem={({ item }) => (
          <EntryRow
            entry={item}
            onRemove={() =>
              Alert.alert('Remove card?', `Drop ${item.printing.name} from this selection?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => removeCard.mutate(item.instanceId) },
              ])
            }
          />
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Selection</Text>
            <Text style={styles.subtitle}>
              {selection.data ? `${selection.data.cards.length} card(s) ready to commit` : ''}
            </Text>
          </View>
        }
        ListEmptyComponent={selection.isLoading ? null : <Empty />}
        contentContainerStyle={styles.list}
      />

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
          style={styles.dangerButton}
          disabled={!selection.data || selection.data.cards.length === 0}
        >
          <Text style={styles.dangerButtonText}>Discard</Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('PickCollection', { selectionId: currentSelectionId })}
          style={[styles.primaryButton, (!selection.data || selection.data.cards.length === 0) && styles.disabled]}
          disabled={!selection.data || selection.data.cards.length === 0}
        >
          <Text style={styles.primaryButtonText}>Commit to collection…</Text>
        </Pressable>
      </View>
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
      <Pressable onPress={onRemove} style={styles.removeButton}>
        <Text style={styles.removeButtonText}>×</Text>
      </Pressable>
    </View>
  );
}

function Empty() {
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>No selection yet</Text>
      <Text style={styles.emptyBody}>Scan a card to start one.</Text>
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
    borderRadius: 16,
    backgroundColor: '#2c3340',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: { color: '#f97373', fontSize: 18, fontWeight: '700' },
  errorText: { color: '#f97373', fontSize: 14, padding: 16 },
  emptyWrap: { padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '600' },
  emptyBody: { color: '#6e7686', fontSize: 14 },
  footer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    backgroundColor: '#0e1117',
    borderTopWidth: 1,
    borderTopColor: '#1a1f29',
  },
  dangerButton: {
    borderColor: '#f97373',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  dangerButtonText: { color: '#f97373', fontSize: 14, fontWeight: '600' },
  primaryButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    flex: 1,
  },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
