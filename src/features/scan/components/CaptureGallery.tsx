import React, { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { needsReview, type CaptureId, type CaptureRecord, type CaptureState } from '../captureQueueReducer';
import { ICONS } from '../../../ui/icons';
import { darkColors as d } from '../../../ui/theme';

type Props = {
  records: CaptureRecord[];
  /** Opens the review modal for a recognised capture. */
  onOpen: (id: CaptureId) => void;
  onRetry: (id: CaptureId) => void;
  onDismiss: (id: CaptureId) => void;
};

export const GALLERY_TILE_SIZE = 80;

/**
 * Bottom-edge strip of capture tiles over the live camera. `pointerEvents="box-none"` keeps the rest of the
 * camera surface interactive (tap-to-focus). Tap: review (recognised) or retry (failed); long-press: discard.
 */
export function CaptureGallery({ records, onOpen, onRetry, onDismiss }: Props) {
  // Newest at the right edge, where the eye lands after a capture.
  const ordered = useMemo(() => [...records].sort((a, b) => a.createdAt - b.createdAt), [records]);

  if (records.length === 0) return null;

  return (
    <View style={styles.outer} pointerEvents="box-none">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {ordered.map((r) => (
          <Tile
            key={r.id}
            record={r}
            onPress={() => {
              if (r.state.kind === 'recognised') onOpen(r.id);
              else if (r.state.kind === 'error') (r.state.uri ? onRetry : onDismiss)(r.id);
            }}
            onLongPress={() => onDismiss(r.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Tile({ record, onPress, onLongPress }: { record: CaptureRecord; onPress: () => void; onLongPress: () => void }) {
  const { state } = record;
  const thumbUri = state.uri ?? null;
  const caption = captionFor(state);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={styles.tile}
      accessibilityLabel={`${caption}. ${accessibilityHintFor(state)}`}
    >
      <View style={[styles.tileImageWrap, needsReview(record) && styles.tileReview, state.kind === 'error' && styles.tileError]}>
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.tileImage} resizeMode="cover" />
        ) : (
          <View style={[styles.tileImage, styles.tileImagePlaceholder]} />
        )}
        <Overlay state={state} />
      </View>
      <Text style={styles.tileCaption} numberOfLines={1}>
        {caption}
      </Text>
    </Pressable>
  );
}

function Overlay({ state }: { state: CaptureState }) {
  switch (state.kind) {
    case 'uploading':
      return (
        <View style={styles.overlayCenter}>
          <ActivityIndicator size="small" color="#fff" />
        </View>
      );
    case 'recognised':
      return state.added != null ? (
        <View style={[styles.overlayBadge, styles.overlayBadgeSuccess]}>
          <MaterialIcons name={ICONS.check} size={14} color={d.bg} />
        </View>
      ) : (
        <View style={[styles.overlayBadge, styles.overlayBadgeWarning]}>
          <MaterialIcons name={ICONS.help} size={14} color={d.bg} />
        </View>
      );
    case 'error':
      return (
        <View style={styles.overlayCenter}>
          <MaterialIcons name={state.uri ? ICONS.refresh : ICONS.alert} size={26} color="#fff" />
        </View>
      );
  }
}

function captionFor(state: CaptureState): string {
  switch (state.kind) {
    case 'uploading':
      return 'Recognising…';
    case 'recognised': {
      if (state.added != null) {
        return state.response.candidates.find((c) => c.printing.id === state.added?.printingId)?.printing.name ?? 'Added';
      }
      return state.response.candidates.length === 0 ? 'No match' : 'Tap to confirm';
    }
    case 'error':
      return state.uri ? 'Tap to retry' : 'Failed';
  }
}

function accessibilityHintFor(state: CaptureState): string {
  switch (state.kind) {
    case 'uploading':
      return 'Long-press to discard.';
    case 'recognised':
      return state.added != null ? 'Tap to change match.' : 'Tap to choose the match.';
    case 'error':
      return state.uri ? 'Tap to retry, long-press to discard.' : 'Tap to discard.';
  }
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    bottom: 16,
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
    width: GALLERY_TILE_SIZE,
    alignItems: 'center',
  },
  tileImageWrap: {
    width: GALLERY_TILE_SIZE,
    height: GALLERY_TILE_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  tileReview: { borderWidth: 2.5, borderColor: d.warning },
  tileError: { borderWidth: 2.5, borderColor: d.danger },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tileImagePlaceholder: {
    backgroundColor: d.surface,
  },
  tileCaption: {
    marginTop: 4,
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: GALLERY_TILE_SIZE,
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
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayBadgeSuccess: { backgroundColor: d.success },
  overlayBadgeWarning: { backgroundColor: d.warning },
});
