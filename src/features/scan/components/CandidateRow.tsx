import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { CardCandidateDto } from '../../../api/generated/models';
import { ICONS } from '../../../ui/icons';
import { darkColors as d } from '../../../ui/theme';

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');

type Props = {
  candidate: CardCandidateDto;
  /** Highlights the row with a brand-coloured border (use for the top match). */
  isTop: boolean;
  onAdd: () => void;
  addPending: boolean;
};

/**
 * Rendered in the camera's review modal, so styling is fixed-dark.
 *
 * One row in the post-scan candidate list. Shows artCrop thumbnail, name +
 * metadata, all sub-scores from the backend, and an "Add" button that fires
 * the parent's `onAdd` handler. Pulled out of `ScanScreen.tsx` so the new
 * `CaptureGallery` review modal can reuse the exact same layout.
 */
export function CandidateRow({ candidate, isTop, onAdd, addPending }: Props) {
  const thumb = candidate.printing.images?.artCrop ?? candidate.printing.images?.normal ?? null;
  return (
    <View style={[styles.row, isTop && styles.rowTop]}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]} />
      )}
      <View style={styles.text}>
        <Text style={styles.name}>{candidate.printing.name}</Text>
        <Text style={styles.meta}>
          {candidate.printing.setCode.toUpperCase()} · #{candidate.printing.collectorNumber} · {candidate.printing.rarity}
        </Text>
        <Text style={styles.scores}>
          combined {fmt(candidate.combinedScore)} · pHash {fmt(candidate.hammingScore)}
          {candidate.hammingDistance != null ? ` (h=${candidate.hammingDistance})` : ''} · ocr {fmt(candidate.ocrAggregateScore)}
        </Text>
        <Text style={styles.scores}>
          name {fmt(candidate.nameScore)} · type {fmt(candidate.typeLineScore)} · rules {fmt(candidate.rulesTextScore)}
        </Text>
        <Text style={styles.scores}>
          P/T {fmt(candidate.powerToughnessScore)} · bottom {fmt(candidate.bottomMetadataScore)} · setW {fmt(candidate.setTypeWeight)}
        </Text>
        <Text style={styles.scores}>
          matched: {candidate.matchedByPHash ? 'pHash' : '—'} {candidate.matchedByName ? '+ name' : ''}
        </Text>
      </View>
      <Pressable
        onPress={onAdd}
        disabled={addPending}
        style={[styles.addButton, addPending && styles.disabled]}
      >
        <MaterialIcons name={ICONS.addCircle} size={16} color={d.onPrimary} />
        <Text style={styles.addButtonText}>Add</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: d.surface,
    borderRadius: 8,
    padding: 8,
    gap: 12,
    alignItems: 'center',
  },
  rowTop: { borderColor: d.primary, borderWidth: 1 },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: d.border },
  thumbPlaceholder: { backgroundColor: d.border },
  text: { flex: 1, gap: 2 },
  name: { color: d.text, fontSize: 15, fontWeight: '600' },
  meta: { color: d.textMuted, fontSize: 12 },
  scores: { color: d.textSubtle, fontSize: 11, fontFamily: 'monospace' },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: d.primary,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  addButtonText: { color: d.onPrimary, fontWeight: '700', fontSize: 13 },
  disabled: { opacity: 0.5 },
});
