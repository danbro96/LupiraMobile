import React, { useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button as PaperButton, Dialog, Portal, Text } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  deleteCollection,
  deleteCollectionCard,
  getCollection,
  updateCollection,
} from '../../api/generated/collections/collections';
import type {
  CardInstanceDto,
} from '../../api/generated/models';
import { CollectionsStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { TextField } from '../../ui/components/TextField';
import { useConfirm } from '../../ui/components/ConfirmDialog';
import { HIT_SLOP, cardSurface, radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';
import { toastError } from '../../feedback/toast';

type Nav = NativeStackNavigationProp<CollectionsStackParamList, 'CollectionDetail'>;
type Route = RouteProp<CollectionsStackParamList, 'CollectionDetail'>;

export function CollectionDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [renameOpen, setRenameOpen] = useState(false);
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  const detail = useQuery({
    queryKey: ['collection', params.collectionId],
    queryFn: () => getCollection(params.collectionId),
  });

  const removeCard = useMutation({
    mutationFn: (instanceId: string) =>
      deleteCollectionCard(params.collectionId, instanceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['collection', params.collectionId] });
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
      await queryClient.invalidateQueries({ queryKey: ['my-cards'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteCollection(params.collectionId),
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
        <View style={styles.headerActions}>
          <Button variant="text" title="Rename" onPress={() => setRenameOpen(true)} />
          <PaperButton
            mode="text"
            textColor={c.danger}
            onPress={async () => {
              const ok = await confirm({
                title: 'Delete collection?',
                message: 'Cards in this collection will be unreachable. Continue?',
                confirmLabel: 'Delete',
                destructive: true,
              });
              if (ok) remove.mutate();
            }}
          >
            Delete
          </PaperButton>
        </View>
      ),
    });
  }, [navigation, detail.data?.name, remove, confirm, styles, c]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={detail.data?.cards ?? []}
        keyExtractor={card => card.instanceId}
        renderItem={({ item }) => (
          <CardRow
            card={item}
            styles={styles}
            palette={c}
            onRemove={async () => {
              const ok = await confirm({
                title: 'Remove card?',
                message: `Drop ${item.printing.name} from this collection?`,
                confirmLabel: 'Remove',
                destructive: true,
              });
              if (ok) removeCard.mutate(item.instanceId);
            }}
          />
        )}
        ListEmptyComponent={
          detail.isLoading ? (
            <ActivityIndicator style={styles.center} />
          ) : (
            <Text variant="bodyMedium" style={styles.emptyText}>No cards in this collection yet.</Text>
          )
        }
        contentContainerStyle={styles.list}
        refreshing={detail.isFetching && !detail.isLoading}
        onRefresh={() => detail.refetch()}
      />

      <RenameDialog
        open={renameOpen}
        currentName={detail.data?.name ?? ''}
        onClose={() => setRenameOpen(false)}
        onSubmit={async name => {
          await updateCollection(params.collectionId, { name });
          await queryClient.invalidateQueries({ queryKey: ['collection', params.collectionId] });
          await queryClient.invalidateQueries({ queryKey: ['collections'] });
          setRenameOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function CardRow({
  card,
  styles,
  palette,
  onRemove,
}: {
  card: CardInstanceDto;
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  onRemove: () => void;
}) {
  const thumb = card.printing.images?.artCrop ?? card.printing.images?.normal ?? null;
  return (
    <View style={styles.row}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={styles.thumb} />
      )}
      <View style={styles.rowText}>
        <Text variant="titleSmall" style={styles.rowName}>{card.printing.name}</Text>
        <Text variant="bodySmall" style={styles.rowMeta}>
          {card.printing.setCode.toUpperCase()} · #{card.printing.collectorNumber} · {card.condition}
          {card.isFoil ? ' · Foil' : ''}
        </Text>
      </View>
      <Pressable onPress={onRemove} style={styles.removeButton} hitSlop={HIT_SLOP}>
        <MaterialIcons name={ICONS.cancel} size={22} color={palette.danger} />
      </Pressable>
    </View>
  );
}

function RenameDialog({
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
      toastError(`Rename failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <Dialog visible={open} onDismiss={onClose}>
        <Dialog.Title>Rename collection</Dialog.Title>
        <Dialog.Content>
          <TextField
            value={draft}
            onChangeText={setDraft}
            maxLength={64}
            placeholder="Collection name"
            style={dialogStyles.input}
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button variant="text" title="Cancel" onPress={onClose} />
          <Button
            variant="text"
            title="Save"
            onPress={submit}
            loading={busy}
            disabled={!draft.trim() || draft.trim() === currentName}
          />
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const dialogStyles = StyleSheet.create({
  input: { flex: 0 },
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    list: { padding: spacing.lg, gap: spacing.sm },
    row: {
      ...cardSurface(c),
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.sm,
      gap: spacing.md,
    },
    thumb: { width: 56, height: 56, borderRadius: radii.sm, backgroundColor: c.border },
    rowText: { flex: 1, gap: 2 },
    rowName: { color: c.text },
    rowMeta: { color: c.textMuted },
    removeButton: {
      width: 32,
      height: 32,
      borderRadius: radii.round,
      backgroundColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: { color: c.textSubtle, textAlign: 'center', padding: spacing.xl },
    center: { padding: spacing.xl, alignItems: 'center' },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
  });
