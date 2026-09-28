import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { CardCandidateDto } from '../../../api/generated/models';
import { ICONS } from '../../../ui/icons';
import { darkColors as d } from '../../../ui/theme';
import { fmtScore as fmt } from '../scanFormat';

type Props = {
  candidate: CardCandidateDto;
  isTop: boolean;
  /** This candidate is the one already in the selection for this capture. */
  isAdded: boolean;
  /** A different candidate is already added, so picking this one swaps it. */
  isSwap: boolean;
  showScores: boolean;
  onAdd: () => void;
  addPending: boolean;
};

/**
 * One match in the camera's review modal (fixed-dark). Uses the full `normal` image: set symbol and
 * frame are what tell printings apart, and the art crop hides both.
 */
export function CandidateRow({ candidate, isTop, isAdded, isSwap, showScores, onAdd, addPending }: Props) {
  const { printing } = candidate;
  const thumb = printing.images?.normal ?? printing.images?.artCrop ?? null;
  return (
    <Pressable
      onPress={onAdd}
      disabled={addPending || isAdded}
      style={[styles.row, isTop && styles.rowTop, isAdded && styles.rowAdded]}
      accessibilityLabel={`${isSwap ? 'Swap to' : 'Add'} ${printing.name}, ${printing.setName}`}
    >
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={styles.thumb} />
      )}
      <View style={styles.text}>
        {isTop ? <Text style={styles.bestMatch}>BEST MATCH</Text> : null}
        <Text style={styles.name} numberOfLines={2}>{printing.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>{printing.setName}</Text>
        <Text style={styles.meta}>
          {printing.setCode.toUpperCase()} #{printing.collectorNumber} · {printing.rarity}
        </Text>
        {showScores ? (
          <>
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
          </>
        ) : null}
      </View>
      {isAdded ? (
        <View style={[styles.action, styles.actionAdded]}>
          <MaterialIcons name={ICONS.check} size={16} color={d.bg} />
          <Text style={styles.actionAddedText}>Added</Text>
        </View>
      ) : (
        <View style={[styles.action, addPending && styles.disabled]}>
          <MaterialIcons name={isSwap ? ICONS.swap : ICONS.addCircle} size={16} color={d.onPrimary} />
          <Text style={styles.actionText}>{isSwap ? 'Swap' : 'Add'}</Text>
        </View>
      )}
    </Pressable>
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
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowTop: { borderColor: d.primary },
  rowAdded: { borderColor: d.success },
  // Scryfall `normal` is 488×680.
  thumb: { width: 64, height: 89, borderRadius: 4, backgroundColor: d.border },
  text: { flex: 1, gap: 2 },
  bestMatch: { color: d.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  name: { color: d.text, fontSize: 15, fontWeight: '600' },
  meta: { color: d.textMuted, fontSize: 12 },
  scores: { color: d.textSubtle, fontSize: 11, fontFamily: 'monospace' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: d.primary,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  actionText: { color: d.onPrimary, fontWeight: '700', fontSize: 13 },
  actionAdded: { backgroundColor: d.success },
  actionAddedText: { color: d.bg, fontWeight: '700', fontSize: 13 },
  disabled: { opacity: 0.5 },
});
