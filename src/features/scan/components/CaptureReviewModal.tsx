import React from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { CardCandidateDto } from '../../../api/generated/models';
import type { CaptureRecord, CaptureState } from '../captureQueueReducer';
import { ICONS } from '../../../ui/icons';
import { darkColors as d, HIT_SLOP } from '../../../ui/theme';
import { CandidateRow } from './CandidateRow';

type Recognised = Extract<CaptureState, { kind: 'recognised' }>;

type Props = {
  record: CaptureRecord | null;
  /** Other captures still waiting for review after this one. */
  remaining: number;
  showScores: boolean;
  pending: boolean;
  onPick: (candidate: CardCandidateDto) => void;
  onSearch: () => void;
  onDiscard: () => void;
  onClose: () => void;
};

/** Bottom sheet over the camera (fixed-dark) for choosing or changing a capture's match. */
export function CaptureReviewModal({ record, remaining, showScores, pending, onPick, onSearch, onDiscard, onClose }: Props) {
  const state = record?.state.kind === 'recognised' ? record.state : null;
  return (
    <Modal visible={state != null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          {state ? (
            <Body
              state={state}
              remaining={remaining}
              showScores={showScores}
              pending={pending}
              onPick={onPick}
              onSearch={onSearch}
              onDiscard={onDiscard}
              onClose={onClose}
            />
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Body({
  state,
  remaining,
  showScores,
  pending,
  onPick,
  onSearch,
  onDiscard,
  onClose,
}: Omit<Props, 'record'> & { state: Recognised }) {
  const { response, added } = state;
  const title = added ? 'Change match' : response.candidates.length === 0 ? 'No match found' : 'Which card is this?';
  const subtitle = remaining > 0 ? `${remaining} more to review` : showScores ? `Confidence: ${response.confidence}` : null;

  return (
    <View style={styles.inner}>
      <View style={styles.header}>
        <Image source={{ uri: state.uri }} style={styles.capture} />
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <Pressable onPress={onClose} hitSlop={HIT_SLOP} style={styles.close} accessibilityLabel="Close">
          <MaterialIcons name={ICONS.close} size={22} color={d.textMuted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {response.candidates.length === 0 ? (
          <Text style={styles.empty}>Couldn't recognise this card. Search for it by name, or discard and rescan.</Text>
        ) : (
          response.candidates.map((c, idx) => (
            <CandidateRow
              key={c.printing.id}
              candidate={c}
              isTop={idx === 0}
              isAdded={added?.printingId === c.printing.id}
              isSwap={added != null && added.printingId !== c.printing.id}
              showScores={showScores}
              onAdd={() => onPick(c)}
              addPending={pending}
            />
          ))
        )}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable onPress={onDiscard} style={[styles.action, styles.discard]} disabled={pending}>
          <MaterialIcons name={ICONS.delete} size={16} color={d.danger} />
          <Text style={styles.discardText}>{added ? 'Remove' : 'Discard'}</Text>
        </Pressable>
        <Pressable onPress={onSearch} style={[styles.action, styles.search]} disabled={pending}>
          <MaterialIcons name={ICONS.search} size={16} color={d.text} />
          <Text style={styles.searchText}>Not listed? Search</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: d.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '85%',
  },
  inner: { paddingTop: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: d.divider,
  },
  capture: { width: 56, height: 78, borderRadius: 6, backgroundColor: d.surface },
  headerText: { flex: 1 },
  title: { color: d.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: d.textMuted, fontSize: 12, marginTop: 2 },
  close: { padding: 4 },
  scroll: { padding: 16, gap: 8 },
  empty: { color: d.textSubtle, fontSize: 14, textAlign: 'center', padding: 24 },
  actions: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 24,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: d.divider,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  discard: { borderColor: d.danger },
  discardText: { color: d.danger, fontSize: 14, fontWeight: '600' },
  search: { borderColor: d.border },
  searchText: { color: d.text, fontSize: 14, fontWeight: '600' },
});
