import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Image,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApiError, mtgApi } from '../../api/mtg-client';
import {
  CardCandidateResponse,
  RecognitionConfidence,
  ScanResponse,
} from '../../api/mtg-types';
import { ScanStackParamList } from '../../navigation/types';
import { useCurrentSelection } from './useCurrentSelection';
import { useScanSettings } from '../../store/scan-settings-store';
import {
  type FrameSize,
  type Quad,
  useCardDetection,
} from './detection/useCardDetection';
import { cropToQuad } from './detection/cropToQuad';
import { DetectionOverlay } from './components/DetectionOverlay';
import { DebugMetricsPanel } from './components/DebugMetricsPanel';
import { ErrorBoundary } from './components/ErrorBoundary';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'Scan'>;

type CapturedShot = {
  uri: string;
  cropped: boolean;
};

export function ScanScreen() {
  const navigation = useNavigation<Nav>();
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setAppState(next));
    return () => sub.remove();
  }, []);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const cameraRef = useRef<Camera | null>(null);
  const [shot, setShot] = useState<CapturedShot | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const queryClient = useQueryClient();

  const settings = useScanSettings();
  useEffect(() => {
    if (!settings.loaded) void settings.load();
  }, [settings]);

  const { ensure: ensureSelection, currentSelectionId } = useCurrentSelection();

  const scan = useMutation({
    mutationFn: (uri: string) =>
      mtgApi.scanCard({ uri, mimeType: 'image/jpeg', fileName: 'scan.jpg' }),
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

  const capturingRef = useRef(false);
  const [capturing, setCapturing] = useState(false);

  const captureAndScan = useCallback(
    async (quad: Quad | null, frameSize: FrameSize | null) => {
      if (!cameraRef.current || capturingRef.current) return;
      capturingRef.current = true;
      setCapturing(true);
      try {
        const photo = await cameraRef.current.takePhoto({
          flash: 'off',
        });
        const photoUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;

        let uploadUri = photoUri;
        let cropped = false;
        if (quad && frameSize) {
          try {
            const result = await cropToQuad({
              photoUri,
              photoWidth: photo.width,
              photoHeight: photo.height,
              quad,
              frameSize,
              jpegQuality: settings.jpegQuality,
            });
            uploadUri = result.uri.startsWith('file://') ? result.uri : `file://${result.uri}`;
            cropped = true;
          } catch (e) {
            // Crop failed -> fall through and upload the raw still so the user is not blocked.
            console.warn('cropToQuad failed, falling back to uncropped upload', e);
          }
        }

        setShot({ uri: uploadUri, cropped });
        scan.mutate(uploadUri);
      } finally {
        capturingRef.current = false;
        setCapturing(false);
      }
    },
    [scan, settings.jpegQuality],
  );

  const uploadStatus: 'idle' | 'pending' | 'success' | 'error' = scan.isPending
    ? 'pending'
    : scan.isError
      ? 'error'
      : scan.isSuccess
        ? 'success'
        : 'idle';

  const onAutoCapture = useCallback(
    (quad: Quad, frameSize: FrameSize) => {
      void captureAndScan(quad, frameSize);
    },
    [captureAndScan],
  );

  const detection = useCardDetection({
    enabled: !shot && !scan.isPending && hasPermission && settings.loaded,
    autoCaptureEnabled: settings.autoCaptureEnabled,
    threshold: settings.captureThreshold,
    minStableFrames: settings.minStableFrames,
    weightStability: settings.weightStability,
    weightSharpness: settings.weightSharpness,
    weightCoverage: settings.weightCoverage,
    onAutoCapture,
  });

  const onManualCapture = useCallback(() => {
    void captureAndScan(detection.quad.value, detection.metrics.value.frameSize);
  }, [captureAndScan, detection.quad, detection.metrics]);

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
  const goToSettings = () => navigation.navigate('ScanSettings');

  const onCameraLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  }, []);

  const overlayThreshold = settings.captureThreshold;
  const overlayMinFrames = settings.minStableFrames;

  const showDebug = useMemo(() => settings.showDebugOverlay, [settings.showDebugOverlay]);

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.permissionWrap}>
          <Text style={styles.permissionTitle}>Camera access required</Text>
          <Text style={styles.permissionBody}>
            Lupira MTG uses the camera to scan Magic: The Gathering cards. Tap below to grant access.
          </Text>
          <Pressable onPress={() => void requestPermission()} style={styles.primaryButton}>
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
          {shot.cropped ? (
            <Text style={styles.croppedNote}>Sent perspective-corrected card crop.</Text>
          ) : (
            <Text style={styles.croppedNote}>Sent raw frame (no quad detected).</Text>
          )}

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

  if (!device) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={styles.center} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container} onLayout={onCameraLayout}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isFocused && appState === 'active' && !shot}
        photo
        pixelFormat="rgb"
        frameProcessor={detection.frameProcessor}
      />

      {containerSize.width > 0 ? (
        <DetectionOverlay
          quad={detection.quad}
          metrics={detection.metrics}
          stableFrames={detection.stableFrames}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
          threshold={overlayThreshold}
          minStableFrames={overlayMinFrames}
        />
      ) : null}

      {showDebug ? (
        <ErrorBoundary label="DebugMetricsPanel">
          <DebugMetricsPanel
            metrics={detection.metrics}
            stableFrames={detection.stableFrames}
            threshold={overlayThreshold}
            minStableFrames={overlayMinFrames}
            weightStability={settings.weightStability}
            weightSharpness={settings.weightSharpness}
            weightCoverage={settings.weightCoverage}
            autoCaptureEnabled={settings.autoCaptureEnabled}
            capturing={capturing}
            uploadStatus={uploadStatus}
          />
        </ErrorBoundary>
      ) : null}

      <View style={styles.cameraOverlay} pointerEvents="box-none">
        <View style={styles.captureBar}>
          <Pressable
            onPress={onManualCapture}
            style={styles.shutter}
            accessibilityLabel="Capture card"
          />
        </View>
        <Pressable style={styles.gearButton} onPress={goToSettings} accessibilityLabel="Scan settings">
          <Text style={styles.gearGlyph}>⚙︎</Text>
        </Pressable>
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

      <BackendDebugBlock data={data} />
    </View>
  );
}

function BackendDebugBlock({ data }: { data: ScanResponse }) {
  const d = data.debug;
  return (
    <View style={styles.debugBlock}>
      <Text style={styles.debugTitle}>Backend debug</Text>

      <Text style={styles.debugSubtitle}>Pipeline</Text>
      <Text style={styles.debugLine}>
        OCR {d.ocrLatencyMs}ms · pHash {d.pHashLatencyMs}ms
      </Text>
      <Text style={styles.debugLine}>
        pHash candidates: {d.pHashCandidateCount} · OCR candidates: {d.ocrCandidateCount}
      </Text>
      <Text style={styles.debugLine}>OCR regions: {d.ocrRegionCount}</Text>
      <Text style={styles.debugLine}>
        imagePHash: {d.imagePHash != null ? d.imagePHash.toString() : '—'}
      </Text>

      <Text style={styles.debugSubtitle}>Crop (server-side)</Text>
      <Text style={styles.debugLine}>
        cropped: {d.cropped ? 'yes' : 'no'} · confidence {d.cropConfidence.toFixed(2)}
      </Text>
      <Text style={styles.debugLine}>
        cropped size: {d.croppedWidth}x{d.croppedHeight}
      </Text>

      <Text style={styles.debugSubtitle}>Set symbol</Text>
      {d.setSymbol ? (
        <>
          <Text style={styles.debugLine}>
            set: {d.setSymbol.setCode.toUpperCase()} · score {d.setSymbol.score.toFixed(2)} · h={d.setSymbol.hammingDistance}
          </Text>
        </>
      ) : (
        <Text style={styles.debugLine}>not detected</Text>
      )}

      <Text style={styles.debugSubtitle}>OCR zones</Text>
      <ZoneLine label="name" value={d.zones.name} />
      <ZoneLine label="type" value={d.zones.typeLine} />
      <ZoneLine label="rules" value={d.zones.rulesText} />
      <ZoneLine label="P/T" value={d.zones.powerToughness} />
      <ZoneLine label="bottom" value={d.zones.bottomMetadata} />

      <Text style={styles.debugSubtitle}>Raw response</Text>
      <Text style={styles.debugLine} selectable>
        {JSON.stringify(data, null, 2)}
      </Text>
    </View>
  );
}

function ZoneLine({ label, value }: { label: string; value: string }) {
  const trimmed = value?.trim() ?? '';
  return (
    <Text style={styles.debugLine} numberOfLines={4}>
      <Text style={styles.zoneLabel}>{label}: </Text>
      {trimmed.length > 0 ? trimmed : '(empty)'}
    </Text>
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
          combined {candidate.combinedScore.toFixed(2)} · pHash {candidate.hammingScore.toFixed(2)}
          {candidate.hammingDistance != null ? ` (h=${candidate.hammingDistance})` : ''} · ocr {candidate.ocrAggregateScore.toFixed(2)}
        </Text>
        <Text style={styles.candidateScores}>
          name {candidate.nameScore.toFixed(2)} · type {candidate.typeLineScore.toFixed(2)} · rules {candidate.rulesTextScore.toFixed(2)}
        </Text>
        <Text style={styles.candidateScores}>
          P/T {candidate.powerToughnessScore.toFixed(2)} · bottom {candidate.bottomMetadataScore.toFixed(2)} · setW {candidate.setTypeWeight.toFixed(2)}
        </Text>
        <Text style={styles.candidateScores}>
          matched: {candidate.matchedByPHash ? 'pHash' : '—'} {candidate.matchedByName ? '+ name' : ''}
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
  cameraOverlay: { ...StyleSheet.absoluteFillObject },
  captureBar: { position: 'absolute', bottom: 48, alignSelf: 'center', left: 0, right: 0, alignItems: 'center' },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: '#3b82f6',
  },
  gearButton: {
    position: 'absolute',
    top: 48,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(8,12,22,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearGlyph: { color: '#fff', fontSize: 20 },
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
  croppedNote: { color: '#6e7686', fontSize: 12, fontStyle: 'italic' },
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
  debugSubtitle: {
    color: '#3b82f6',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
  },
  debugLine: { color: '#9aa3b2', fontSize: 11, fontFamily: 'monospace' },
  zoneLabel: { color: '#6e7686', fontSize: 11, fontFamily: 'monospace' },
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
