import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { CardCandidateResponse } from '../../../api/generated/models';
import type {
  CaptureId,
  CaptureRecord,
  CaptureState,
} from '../captureQueueReducer';
import { Icon } from '../../../components/Icon';
import { CandidateRow } from './CandidateRow';

type Props = {
  records: CaptureRecord[];
  /** Adds the chosen candidate to the current selection. */
  onAdd: (id: CaptureId, candidate: CardCandidateResponse) => void;
  /** Removes a record from the queue (swipe-away / explicit dismiss). */
  onDismiss: (id: CaptureId) => void;
};

/**
 * Bottom-edge horizontal gallery of capture tiles, pinned over the live camera with
 * `pointerEvents="box-none"` on the outer container so the rest of the camera surface stays interactive
 * (tap-to-focus, etc.). Each tile's look is derived from its record's `state.kind`.
 *
 * Tapping a "staged" (medium/low confidence) tile opens an inline modal with the full candidate list so the user
 * can pick the correct match without leaving the camera. Dismissing leaves the tile in place to come back to.
 */
export function CaptureGallery({ records, onAdd, onDismiss }: Props) {
  const [reviewing, setReviewing] = useState<CaptureId | null>(null);
  const reviewingRecord = useMemo(
    () => records.find((r) => r.id === reviewing) ?? null,
    [records, reviewing],
  );

  // Newest captures at the right edge. The camera UI is most useful when the
  // user can immediately see the most recent thumbnail.
  const ordered = useMemo(
    () => [...records].sort((a, b) => a.createdAt - b.createdAt),
    [records],
  );

  if (records.length === 0 && reviewing == null) {
    return null;
  }

  return (
    <>
      <View style={styles.outer} pointerEvents="box-none">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {ordered.map((r) => (
            <Tile
              key={r.id}
              record={r}
              onPress={() => {
                if (r.state.kind === 'recognised' && r.state.addedPrintingId == null) {
                  setReviewing(r.id);
                } else if (r.state.kind === 'error') {
                  onDismiss(r.id);
                }
              }}
              onLongPress={() => onDismiss(r.id)}
            />
          ))}
        </ScrollView>
      </View>

      <Modal
        visible={reviewingRecord != null}
        animationType="slide"
        transparent
        onRequestClose={() => setReviewing(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setReviewing(null)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            {reviewingRecord && reviewingRecord.state.kind === 'recognised' ? (
              <ReviewModalBody
                state={reviewingRecord.state}
                onAdd={(candidate) => {
                  onAdd(reviewingRecord.id, candidate);
                  setReviewing(null);
                }}
                onDismiss={() => {
                  onDismiss(reviewingRecord.id);
                  setReviewing(null);
                }}
                onClose={() => setReviewing(null)}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Tile({
  record,
  onPress,
  onLongPress,
}: {
  record: CaptureRecord;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { state } = record;

  const thumbUri = thumbnailUriFor(state);
  const overlay = overlayFor(state);
  const caption = captionFor(state);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={styles.tile}
    >
      <View style={styles.tileImageWrap}>
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.tileImage} resizeMode="cover" />
        ) : (
          <View style={[styles.tileImage, styles.tileImagePlaceholder]} />
        )}
        {overlay}
      </View>
      {caption ? (
        <Text style={styles.tileCaption} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ReviewModalBody({
  state,
  onAdd,
  onDismiss,
  onClose,
}: {
  state: Extract<CaptureState, { kind: 'recognised' }>;
  onAdd: (candidate: CardCandidateResponse) => void;
  onDismiss: () => void;
  onClose: () => void;
}) {
  const { response } = state;
  return (
    <View style={styles.modalInner}>
      <View style={styles.modalHeader}>
        <Image source={{ uri: state.uri }} style={styles.modalThumb} />
        <View style={styles.modalHeaderText}>
          <Text style={styles.modalTitle}>Pick the correct match</Text>
          <Text style={styles.modalSubtitle}>
            Confidence: {response.confidence.toUpperCase()} · {response.candidates.length} candidate{response.candidates.length === 1 ? '' : 's'}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={styles.modalClose}>
          <Icon name="close" size={22} color="muted" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.modalScroll}>
        {response.candidates.length === 0 ? (
          <Text style={styles.modalEmpty}>
            No matches in the local catalogue. Re-scan with better lighting.
          </Text>
        ) : (
          response.candidates.map((c, idx) => (
            <CandidateRow
              key={c.printing.id}
              candidate={c}
              isTop={idx === 0}
              onAdd={() => onAdd(c)}
              addPending={false}
            />
          ))
        )}
      </ScrollView>

      <View style={styles.modalActions}>
        <Pressable onPress={onDismiss} style={[styles.modalAction, styles.modalDismiss]}>
          <Icon name="trash-outline" size={16} color="destructive" />
          <Text style={styles.modalDismissText}>Discard scan</Text>
        </Pressable>
      </View>
    </View>
  );
}

function thumbnailUriFor(state: CaptureState): string | null {
  switch (state.kind) {
    case 'uploading':
    case 'recognised':
      return state.uri;
    case 'error':
      return state.uri ?? null;
    case 'capturing':
      return null;
  }
}

function overlayFor(state: CaptureState): React.ReactNode {
  switch (state.kind) {
    case 'capturing':
      return (
        <View style={styles.overlayCenter}>
          <ActivityIndicator size="small" color="#fff" />
        </View>
      );
    case 'uploading':
      return (
        <View style={styles.overlayCenter}>
          <ActivityIndicator size="small" color="#fff" />
        </View>
      );
    case 'recognised':
      if (state.addedPrintingId != null) {
        return (
          <View style={[styles.overlayBadge, styles.overlayBadgeSuccess]}>
            <Icon name="checkmark" size={12} color="white" />
          </View>
        );
      }
      return (
        <View style={[styles.overlayBadge, styles.overlayBadgeWarning]}>
          <Icon name="help" size={12} color="white" />
        </View>
      );
    case 'error':
      return (
        <View style={[styles.overlayBadge, styles.overlayBadgeError]}>
          <Icon name="alert" size={12} color="white" />
        </View>
      );
  }
}

function captionFor(state: CaptureState): string | null {
  switch (state.kind) {
    case 'capturing':
      return 'Capturing…';
    case 'uploading':
      return 'Recognising…';
    case 'recognised':
      if (state.response.candidates.length === 0) return 'No match';
      return state.response.candidates[0].printing.name;
    case 'error':
      return 'Failed';
  }
}

const TILE_SIZE = 72;

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
  },
  strip: {
    paddingHorizontal: 12,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  tile: {
    width: TILE_SIZE,
    alignItems: 'center',
  },
  tileImageWrap: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tileImagePlaceholder: {
    backgroundColor: '#1a1f29',
  },
  tileCaption: {
    marginTop: 4,
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: TILE_SIZE,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  overlayCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  overlayBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayBadgeSuccess: { backgroundColor: '#22c55e' },
  overlayBadgeWarning: { backgroundColor: '#f59e0b' },
  overlayBadgeError: { backgroundColor: '#ef4444' },

  // Review modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#0e1117',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
  },
  modalInner: {
    paddingTop: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1f29',
  },
  modalThumb: {
    width: 56,
    height: 78,
    borderRadius: 6,
    backgroundColor: '#1a1f29',
  },
  modalHeaderText: { flex: 1 },
  modalTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '700' },
  modalSubtitle: { color: '#9aa3b2', fontSize: 12, marginTop: 2 },
  modalClose: { padding: 4 },
  modalScroll: {
    padding: 16,
    gap: 8,
  },
  modalEmpty: {
    color: '#6e7686',
    fontSize: 14,
    textAlign: 'center',
    padding: 24,
  },
  modalActions: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 24,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1f29',
  },
  modalAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
  },
  modalDismiss: {
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  modalDismissText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
});
