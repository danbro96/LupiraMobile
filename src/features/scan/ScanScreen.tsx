import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApiError, mtgApi } from '../../api/mtg-client';
import {
  CardCandidateResponse,
  RecognitionConfidence,
  ScanResponse,
} from '../../api/mtg-types';
import { ScanStackParamList } from '../../navigation/types';
import { useCurrentSelection } from './useCurrentSelection';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'Scan'>;

type CapturedShot = {
  uri: string;
};

export function ScanScreen() {
  const navigation = useNavigation<Nav>();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [shot, setShot] = useState<CapturedShot | null>(null);
  const queryClient = useQueryClient();

  const { ensure: ensureSelection, currentSelectionId } = useCurrentSelection();

  const scan = useMutation({
    mutationFn: (uri: string) => mtgApi.scanCard({ uri, mimeType: 'image/jpeg', fileName: 'scan.jpg' }),
  });

  const selectionQuery = useQuery({
    queryKey: ['selection', currentSelectionId],
    queryFn: () => mtgApi.selections.get(currentSelectionId!),
    enabled: !!currentSelectionId,
  });

  const addToSelection = useMutation({
    mutationFn: async (input: { candidate: CardCandidateResponse; allowDuplicate: boolean }) => {
      const selectionId = await ensureSelection();
      return mtgApi.selections.addCard(selectionId, {
        printingId: input.candidate.printing.id,
        foil: false,
        language: 'en',
        condition: 'NM',
        confidence: input.candidate.combinedScore,
        allowDuplicate: input.allowDuplicate,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['selection'] });
    },
  });

  const onCapture = useCallback(async () => {
    if (!cameraRef.current) return;
    const picture = await cameraRef.current.takePictureAsync({
      quality: 0.5,
      base64: false,
      skipProcessing: false,
    });
    if (!picture?.uri) return;
    setShot({ uri: picture.uri });
    scan.mutate(picture.uri);
  }, [scan]);

  const onAdd = useCallback(
    async (candidate: CardCandidateResponse) => {
      try {
        await addToSelection.mutateAsync({ candidate, allowDuplicate: false });
      } catch (e: unknown) {
        if (e instanceof ApiError && e.status === 409) {
          Alert.alert(
            'Already in selection',
            'This printing is already in your current selection. Add another copy?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Add another',
                onPress: () => addToSelection.mutate({ candidate, allowDuplicate: true }),
              },
            ],
          );
        } else {
          Alert.alert('Add failed', (e as Error).message);
        }
      }
    },
    [addToSelection],
  );

  const onRetake = useCallback(() => {
    setShot(null);
    scan.reset();
  }, [scan]);

  const selectionCount = selectionQuery.data?.cards.length ?? 0;
  const goToSelection = () => navigation.navigate('Selection');

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={styles.center} />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.permissionWrap}>
          <Text style={styles.permissionTitle}>Camera access required</Text>
          <Text style={styles.permissionBody}>
            Lupira MTG uses the camera to scan Magic: The Gathering cards. Tap below to grant access.
          </Text>
          <Pressable onPress={requestPermission} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Grant access</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (shot) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.resultScroll}>
          <Image source={{ uri: shot.uri }} style={styles.resultPreview} resizeMode="contain" />

          {scan.isPending ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color="#3b82f6" />
              <Text style={styles.statusText}>Recognizing…</Text>
            </View>
          ) : null}

          {scan.isError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{(scan.error as Error).message}</Text>
            </View>
          ) : null}

          {scan.data ? (
            <ResultList
              data={scan.data}
              onAdd={onAdd}
              addPending={addToSelection.isPending}
            />
          ) : null}

          <View style={styles.actions}>
            <Pressable onPress={onRetake} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Retake</Text>
            </Pressable>
            <Pressable onPress={goToSelection} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>
                Selection {selectionCount > 0 ? `(${selectionCount})` : ''}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <View style={styles.cameraOverlay} pointerEvents="box-none">
        <View style={styles.viewfinderFrame} />
        <View style={styles.captureBar}>
          <Pressable onPress={onCapture} style={styles.shutter} accessibilityLabel="Capture card" />
        </View>
        {selectionCount > 0 ? (
          <Pressable style={styles.selectionBadge} onPress={goToSelection}>
            <Text style={styles.selectionBadgeText}>Selection · {selectionCount}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ResultList({
  data,
  onAdd,
  addPending,
}: {
  data: ScanResponse;
  onAdd: (candidate: CardCandidateResponse) => void;
  addPending: boolean;
}) {
  return (
    <View style={styles.resultBlock}>
      <View style={styles.confidenceRow}>
        <Text style={styles.confidenceLabel}>Confidence</Text>
        <ConfidenceBadge level={data.confidence} />
      </View>

      {data.candidates.length === 0 ? (
        <Text style={styles.emptyText}>
          No matching cards in the local catalog. Re-scan with better lighting or try a smaller crop.
        </Text>
      ) : null}

      {data.candidates.map((c, idx) => (
        <CandidateRow
          key={c.printing.id}
          candidate={c}
          isTop={idx === 0}
          onAdd={() => onAdd(c)}
          addPending={addPending}
        />
      ))}

      <View style={styles.debugBlock}>
        <Text style={styles.debugTitle}>Debug</Text>
        <Text style={styles.debugLine}>OCR latency: {data.debug.ocrLatencyMs}ms</Text>
        <Text style={styles.debugLine}>pHash latency: {data.debug.pHashLatencyMs}ms</Text>
        <Text style={styles.debugLine}>
          pHash candidates: {data.debug.pHashCandidateCount} · OCR candidates: {data.debug.ocrCandidateCount}
        </Text>
        {data.debug.ocrText ? (
          <Text style={styles.debugLine} numberOfLines={3}>
            OCR text: {data.debug.ocrText}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ConfidenceBadge({ level }: { level: RecognitionConfidence }) {
  const color = level === 'high' ? '#22c55e' : level === 'medium' ? '#f59e0b' : '#f97373';
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{level.toUpperCase()}</Text>
    </View>
  );
}

function CandidateRow({
  candidate,
  isTop,
  onAdd,
  addPending,
}: {
  candidate: CardCandidateResponse;
  isTop: boolean;
  onAdd: () => void;
  addPending: boolean;
}) {
  const thumb = candidate.printing.images?.artCrop ?? candidate.printing.images?.normal ?? null;
  return (
    <View style={[styles.candidateRow, isTop && styles.candidateRowTop]}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.candidateThumb} />
      ) : (
        <View style={[styles.candidateThumb, styles.candidateThumbPlaceholder]} />
      )}
      <View style={styles.candidateText}>
        <Text style={styles.candidateName}>{candidate.printing.name}</Text>
        <Text style={styles.candidateMeta}>
          {candidate.printing.setCode.toUpperCase()} · #{candidate.printing.collectorNumber} · {candidate.printing.rarity}
        </Text>
        <Text style={styles.candidateScores}>
          combined {candidate.combinedScore.toFixed(2)} · name {candidate.nameScore.toFixed(2)} · pHash {candidate.hammingScore.toFixed(2)}
          {candidate.hammingDistance != null ? ` (h=${candidate.hammingDistance})` : ''}
        </Text>
      </View>
      <Pressable
        onPress={onAdd}
        disabled={addPending}
        style={[styles.addButton, addPending && styles.disabled]}
      >
        <Text style={styles.addButtonText}>+ Add</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  camera: { flex: 1 },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  viewfinderFrame: {
    width: '78%',
    aspectRatio: 5 / 7,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#3b82f6',
    opacity: 0.7,
  },
  captureBar: { position: 'absolute', bottom: 48, alignSelf: 'center' },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: '#3b82f6',
  },
  selectionBadge: {
    position: 'absolute',
    top: 48,
    right: 16,
    backgroundColor: '#3b82f6',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  selectionBadgeText: { color: '#fff', fontWeight: '700' },
  permissionWrap: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  permissionTitle: { color: '#f5f5f5', fontSize: 24, fontWeight: '700' },
  permissionBody: { color: '#cbd1da', fontSize: 14, lineHeight: 20 },
  primaryButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    flex: 1,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resultScroll: { padding: 16, gap: 16 },
  resultPreview: { width: '100%', height: 280, borderRadius: 12, backgroundColor: '#1a1f29' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusText: { color: '#cbd1da', fontSize: 14 },
  errorBox: { backgroundColor: '#2a1414', padding: 12, borderRadius: 8 },
  errorText: { color: '#f97373', fontSize: 14 },
  resultBlock: { gap: 12 },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  confidenceLabel: { color: '#9aa3b2', fontSize: 14 },
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  emptyText: { color: '#6e7686', fontSize: 14, textAlign: 'center', padding: 16 },
  candidateRow: {
    flexDirection: 'row',
    backgroundColor: '#1a1f29',
    borderRadius: 8,
    padding: 8,
    gap: 12,
    alignItems: 'center',
  },
  candidateRowTop: { borderColor: '#3b82f6', borderWidth: 1 },
  candidateThumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: '#2c3340' },
  candidateThumbPlaceholder: { backgroundColor: '#2c3340' },
  candidateText: { flex: 1, gap: 2 },
  candidateName: { color: '#f5f5f5', fontSize: 15, fontWeight: '600' },
  candidateMeta: { color: '#9aa3b2', fontSize: 12 },
  candidateScores: { color: '#6e7686', fontSize: 11, fontFamily: 'monospace' },
  addButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  disabled: { opacity: 0.5 },
  debugBlock: {
    backgroundColor: '#101622',
    borderRadius: 8,
    padding: 12,
    gap: 4,
    marginTop: 8,
  },
  debugTitle: { color: '#cbd1da', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  debugLine: { color: '#6e7686', fontSize: 11, fontFamily: 'monospace' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  secondaryButton: {
    borderColor: '#3b82f6',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    flex: 1,
  },
  secondaryButtonText: { color: '#3b82f6', fontSize: 16, fontWeight: '600' },
});
