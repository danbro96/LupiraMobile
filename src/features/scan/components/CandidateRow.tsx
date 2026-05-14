import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { CardCandidateResponse } from '../../../api/generated/models';
import { asNumber } from '../../../api/mutator';
import { Icon } from '../../../components/Icon';

const fmt = (v: string | number | null | undefined) => {
  const n = asNumber(v);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
};

type Props = {
  candidate: CardCandidateResponse;
  /** Highlights the row with a brand-coloured border (use for the top match). */
  isTop: boolean;
  onAdd: () => void;
  addPending: boolean;
};

/**
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
        <Icon name="add-circle" size={16} color="white" />
        <Text style={styles.addButtonText}>Add</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: '#1a1f29',
    borderRadius: 8,
    padding: 8,
    gap: 12,
    alignItems: 'center',
  },
  rowTop: { borderColor: '#3b82f6', borderWidth: 1 },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: '#2c3340' },
  thumbPlaceholder: { backgroundColor: '#2c3340' },
  text: { flex: 1, gap: 2 },
  name: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  meta: { color: '#9aa3b2', fontSize: 12 },
  scores: { color: '#6e7686', fontSize: 11, fontFamily: 'monospace' },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#3b82f6',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  disabled: { opacity: 0.5 },
});
