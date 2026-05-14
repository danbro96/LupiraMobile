import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  type CameraRef,
  useCameraDevices,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';
import { CommonResolutions } from 'react-native-vision-camera';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApiError } from '../../api/mutator';
import {
  getSelectionsSelectionId,
  postSelectionsSelectionIdCards,
} from '../../api/generated/selections/selections';
import { scanCard } from '../../api/scan';
import type { CardCandidateResponse } from '../../api/generated/models';
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
import { GuideFrame } from './components/GuideFrame';
import { CaptureGallery } from './components/CaptureGallery';
import { DecisionStatusPill } from './components/DecisionStatusPill';
import {
  captureQueueReducer,
  newCaptureId,
  type CaptureId,
} from './captureQueueReducer';
import {
  buildLogEntry,
  deriveDecisionReason,
  reasonsEqual,
  useDecisionLog,
  type DecisionReason,
} from './decisionLogStore';
import { Icon } from '../../components/Icon';
import { breadcrumb } from '../../observability/breadcrumb';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'Scan'>;

export function ScanScreen() {
  const navigation = useNavigation<Nav>();
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      breadcrumb('appstate', 'transition', { from: AppState.currentState, to: next });
      setAppState(next);
    });
    return () => sub.remove();
  }, []);
  const { hasPermission, requestPermission } = useCameraPermission();

  // Lens choice: enumerate every back camera and explicitly pick a
  // single-physical wide-angle that exposes focus metering. The simpler
  // `useCameraDevice('back', { physicalDevices: ['wide-angle'] })` returned a
  // logical multicam on Galaxy S23 that reported supportsFocusMetering:false,
  // and our focusTo before capture silently threw — leading to perpetually
  // soft stills. See the perf-trim/focus-lock build history for details.
  const allDevices = useCameraDevices();
  const deviceCandidates = useMemo(
    () =>
      allDevices
        .filter((d) => d.position === 'back')
        .map((d) => ({
          device: d,
          isPhysicalWide: d.type === 'wide-angle' && !d.isVirtualDevice,
          hasAF: d.supportsFocusMetering,
        })),
    [allDevices],
  );
  const device = useMemo(() => {
    const wideAF = deviceCandidates.find((c) => c.isPhysicalWide && c.hasAF);
    if (wideAF) return wideAF.device;
    const anyAF = deviceCandidates.find((c) => c.hasAF);
    if (anyAF) return anyAF.device;
    return deviceCandidates[0]?.device;
  }, [deviceCandidates]);

  const cameraRef = useRef<CameraRef | null>(null);
  // High-quality, AF-aware photo output. The combination of UHD_4_3 +
  // qualityPrioritization='quality' + the explicit focusTo call below is what
  // gives us sharp stills on Android — `qualityPrioritization` alone isn't
  // enough on CameraX.
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.UHD_4_3,
    qualityPrioritization: 'quality',
    quality: 0.92,
    containerFormat: 'jpeg',
  });

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

  const selectionQuery = useQuery({
    queryKey: ['selection', currentSelectionId],
    queryFn: async () => {
      const envelope = await getSelectionsSelectionId(currentSelectionId!);
      return envelope.data;
    },
    enabled: !!currentSelectionId,
  });

  const addToSelection = useMutation({
    mutationFn: async (input: { candidate: CardCandidateResponse; allowDuplicate: boolean }) => {
      const selectionId = await ensureSelection();
      const envelope = await postSelectionsSelectionIdCards(selectionId, {
        printingId: input.candidate.printing.id,
        isFoil: false,
        language: 'en',
        condition: 'NM',
        confidence: input.candidate.combinedScore,
        allowDuplicate: input.allowDuplicate,
      });
      return envelope.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['selection'] });
    },
  });

  // Capture queue. Each in-flight scan is a record in this list; the gallery
  // renders the list directly. Concurrency safety lives entirely in the
  // reducer — the orchestration code below is fire-and-forget per record.
  const [records, dispatch] = useReducer(captureQueueReducer, [] as ReturnType<typeof captureQueueReducer>);

  // Decision-log store handle. We pull `append` once into a ref-style local
  // because zustand's hook returns a fresh function reference per render,
  // and `captureAndScan` shouldn't capture stale ones.
  const appendDecisionLog = useDecisionLog((s) => s.append);

  // Forward refs to detection.pause/resume — captureAndScan is defined before
  // the detection hook is initialised, so we wire these up after. The
  // metrics-ref is the same shape: we need the latest worklet metrics
  // snapshot at the moment auto-capture fires for the 'fired' log entry.
  const resumeDetectionRef = useRef<(() => void) | null>(null);
  const pauseDetectionRef = useRef<(() => void) | null>(null);
  const detectionMetricsRefForLog = useRef<
    | ReturnType<typeof useCardDetection>['metrics']
    | null
  >(null);
  // AppState/isFocused snapshots, accessible from the captureAndScan closure
  // without re-creating the callback on every transition.
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const appStateRef = useRef(appState);
  appStateRef.current = appState;
  // Single concurrent capture lock. fast-opencv's global object store cannot
  // tolerate two cropToQuad calls in flight, and the worklet must be paused
  // while either runs.
  const capturingRef = useRef(false);

  const captureAndScan = useCallback(
    async (quad: Quad, frameSize: FrameSize) => {
      if (capturingRef.current) {
        // Worklet fired again before we finished the prior crop. Drop it —
        // the worklet's content cooldown will keep ignoring this card for a
        // moment longer.
        breadcrumb('capture', 'capture_dropped_busy');
        return;
      }
      // Camera2's ImageCapture detaches across AppState/focus transitions.
      if (!isFocusedRef.current || appStateRef.current !== 'active') {
        breadcrumb('capture', 'capture_skipped_inactive', {
          isFocused: isFocusedRef.current,
          appState: appStateRef.current,
        });
        resumeDetectionRef.current?.();
        return;
      }

      capturingRef.current = true;
      const id: CaptureId = newCaptureId();
      dispatch({ type: 'capture/start', id, createdAt: Date.now() });
      // Append a 'fired' record to the decision log at the exact moment the
      // worklet's auto-capture handed off to JS. The polling effect runs at
      // 500 ms cadence, so without this we'd often miss the fire altogether
      // (between two ticks) — and the most useful entry in any debug
      // session is the one where the trigger actually pulled.
      const m = detectionMetricsRefForLog.current?.getDirty();
      const cx = (quad[0].x + quad[2].x) / 2;
      const cy = (quad[0].y + quad[2].y) / 2;
      const firedReason: DecisionReason = {
        kind: 'fired',
        quadCentroid: { x: cx, y: cy },
      };
      if (m) {
        appendDecisionLog(buildLogEntry(m, firedReason));
      }
      // Worklet must be silent during the whole OpenCV stretch.
      pauseDetectionRef.current?.();

      breadcrumb('capture', 'capture_start', {
        id,
        frameW: frameSize.width,
        frameH: frameSize.height,
      });

      let photo: Awaited<ReturnType<typeof photoOutput.capturePhoto>> | null = null;
      try {
        // Force AF + AE to settle before snapping.
        const cw = containerSize.width;
        const ch = containerSize.height;
        if (cameraRef.current && cw > 0 && ch > 0) {
          try {
            await cameraRef.current.focusTo({ x: cw / 2, y: ch / 2 }, { modes: ['AF', 'AE'] });
            await new Promise((r) => setTimeout(r, 80));
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            breadcrumb('capture', 'focus_lock_skip', { error: msg }, 'warning');
          }
        }

        try {
          photo = await photoOutput.capturePhoto(
            { flashMode: 'off', enableShutterSound: false, enableDistortionCorrection: true },
            {},
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('Not bound to a valid Camera') || msg.includes('not bound')) {
            // Transient: drop the record and resume detection. The worklet
            // will fire again on the next stable frame.
            breadcrumb('capture', 'capture_camera_unbound', { id, error: msg }, 'warning');
            dispatch({ type: 'capture/dismiss', id });
            return;
          }
          throw err;
        }

        const tempPath = await photo.saveToTemporaryFileAsync();
        const photoUri = tempPath.startsWith('file://') ? tempPath : `file://${tempPath}`;
        const photoWidth = photo.width;
        const photoHeight = photo.height;

        breadcrumb('crop', 'crop_start', { id, photoW: photoWidth, photoH: photoHeight });
        let uploadUri: string;
        try {
          const result = await cropToQuad({
            photoUri,
            photoWidth,
            photoHeight,
            quad,
            frameSize,
            jpegQuality: settings.jpegQuality,
          });
          uploadUri = result.uri.startsWith('file://') ? result.uri : `file://${result.uri}`;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          breadcrumb('crop', 'crop_failed_aborting', { id, error: msg }, 'error');
          dispatch({ type: 'capture/error', id, message: 'Crop failed' });
          return;
        }

        dispatch({
          type: 'capture/uploading',
          id,
          uri: uploadUri,
          sourceWidth: photoWidth,
          sourceHeight: photoHeight,
        });

        // Fire-and-forget the upload so the next capture can start
        // immediately. The reducer keys the response back by `id`.
        void (async () => {
          try {
            const response = await scanCard({
              uri: uploadUri,
              mimeType: 'image/jpeg',
              fileName: 'scan.jpg',
            });
            dispatch({ type: 'capture/recognised', id, response });

            // Hybrid auto-add: only when the backend reports high confidence.
            // Lower-confidence captures stay staged for tap-to-confirm review.
            // Enum is PascalCase per the OpenAPI spec
            // (`new JsonStringEnumConverter()` keeps C# enum names verbatim).
            if (response.confidence === 'High' && response.candidates.length > 0) {
              const top = response.candidates[0];
              dispatch({ type: 'capture/auto-add', id, printingId: top.printing.id });
              addToSelection.mutate(
                { candidate: top, allowDuplicate: false },
                {
                  onError: (err) => {
                    if (err instanceof ApiError && err.status === 409) {
                      // Already in the selection — fine, leave the green
                      // check on the tile so the user knows it was matched.
                      return;
                    }
                    breadcrumb(
                      'upload',
                      'auto_add_failed',
                      { id, error: err instanceof Error ? err.message : String(err) },
                      'warning',
                    );
                  },
                },
              );
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            breadcrumb('upload', 'scan_failed', { id, error: msg }, 'error');
            dispatch({ type: 'capture/error', id, message: msg });
          }
        })();
      } finally {
        photo?.dispose();
        capturingRef.current = false;
        // Reopen the worklet ASAP so the user can sweep onto the next card
        // while the previous upload is still in flight.
        resumeDetectionRef.current?.();
      }
    },
    [photoOutput, settings.jpegQuality, addToSelection, containerSize.width, containerSize.height],
  );

  const onAutoCapture = useCallback(
    (quad: Quad, frameSize: FrameSize) => {
      void captureAndScan(quad, frameSize);
    },
    [captureAndScan],
  );

  const detection = useCardDetection({
    enabled: hasPermission && settings.loaded,
    autoCaptureEnabled: settings.autoCaptureEnabled,
    threshold: settings.captureThreshold,
    minStableFrames: settings.minStableFrames,
    weightStability: settings.weightStability,
    weightSharpness: settings.weightSharpness,
    weightCoverage: settings.weightCoverage,
    weightBrightness: settings.weightBrightness,
    onAutoCapture,
  });
  resumeDetectionRef.current = detection.resume;
  pauseDetectionRef.current = detection.pause;
  detectionMetricsRefForLog.current = detection.metrics;

  // Bridge worklet-thread state into Sentry breadcrumbs at low frequency.
  const lastSampledStep = useRef<string>('');
  const lastSampledError = useRef<string>('');
  // Last decision reason we appended to the log. Used to de-duplicate — a
  // long blocked-sharpness stretch should be one entry, not 60 redundant
  // copies that hide the moment the situation changed.
  const lastSampledReason = useRef<DecisionReason | undefined>(undefined);
  useEffect(() => {
    const id = setInterval(() => {
      const m = detection.metrics.getDirty();
      if (m.lastStep && m.lastStep !== lastSampledStep.current) {
        lastSampledStep.current = m.lastStep;
        breadcrumb('frame_processor', `step=${m.lastStep}`, {
          framesProcessed: m.framesProcessed,
          contourCount: m.contourCount,
          edgePixelCount: m.edgePixelCount,
          frameW: m.frameSize.width,
          frameH: m.frameSize.height,
          pixelFormat: m.pixelFormat,
        });
      }
      if (m.lastError && m.lastError !== lastSampledError.current) {
        lastSampledError.current = m.lastError;
        breadcrumb(
          'frame_processor',
          'worklet_error',
          { error: m.lastError, lastStep: m.lastStep, framesProcessed: m.framesProcessed },
          'error',
        );
      }

      // Decision-log: derive a structured reason from the current metrics
      // and append on transitions only. `fired` events are appended
      // separately from captureAndScan so they're never lost between ticks.
      const reason = deriveDecisionReason(m, settings.captureThreshold);
      if (!reasonsEqual(lastSampledReason.current, reason)) {
        lastSampledReason.current = reason;
        appendDecisionLog(buildLogEntry(m, reason));
      }
    }, 500);
    return () => clearInterval(id);
  }, [detection.metrics, settings.captureThreshold, appendDecisionLog]);

  // Tile add (manual review) — used by the gallery's modal.
  const onAddFromReview = useCallback(
    (id: CaptureId, candidate: CardCandidateResponse) => {
      addToSelection.mutate(
        { candidate, allowDuplicate: false },
        {
          onSuccess: () => dispatch({ type: 'capture/auto-add', id, printingId: candidate.printing.id }),
          onError: (err) => {
            if (err instanceof ApiError && err.status === 409) {
              Alert.alert(
                'Already in selection',
                'This printing is already in your current selection. Add another copy?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Add another',
                    onPress: () =>
                      addToSelection.mutate(
                        { candidate, allowDuplicate: true },
                        {
                          onSuccess: () =>
                            dispatch({ type: 'capture/auto-add', id, printingId: candidate.printing.id }),
                        },
                      ),
                  },
                ],
              );
            } else {
              Alert.alert('Add failed', (err as Error).message);
            }
          },
        },
      );
    },
    [addToSelection],
  );
  const onDismissTile = useCallback((id: CaptureId) => {
    dispatch({ type: 'capture/dismiss', id });
  }, []);

  const selectionCount = selectionQuery.data?.cards.length ?? 0;
  const goToSelection = () => navigation.navigate('Selection');
  const goToSettings = () => navigation.navigate('ScanSettings');

  const onCameraLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  }, []);

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
        // Camera is active whenever the tab is focused and the app is in the
        // foreground. No more capture-result modal that needs to gate this.
        isActive={isFocused && appState === 'active'}
        outputs={[photoOutput, detection.frameOutput]}
        enableNativeTapToFocusGesture
      />

      {containerSize.width > 0 ? (
        <>
          <GuideFrame containerWidth={containerSize.width} containerHeight={containerSize.height} />
          <DetectionOverlay
            quad={detection.quad}
            metrics={detection.metrics}
            stableFrames={detection.stableFrames}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            threshold={settings.captureThreshold}
            minStableFrames={settings.minStableFrames}
          />
        </>
      ) : null}

      {showDebug ? (
        <ErrorBoundary label="DebugMetricsPanel">
          <DebugMetricsPanel
            metrics={detection.metrics}
            stableFrames={detection.stableFrames}
            threshold={settings.captureThreshold}
            minStableFrames={settings.minStableFrames}
            weightStability={settings.weightStability}
            weightSharpness={settings.weightSharpness}
            weightCoverage={settings.weightCoverage}
            autoCaptureEnabled={settings.autoCaptureEnabled}
            capturing={false}
            uploadStatus="idle"
          />
        </ErrorBoundary>
      ) : null}

      <FrameTheCardHint metrics={detection.metrics} hasRecords={records.length > 0} />

      <View style={styles.lensBadge} pointerEvents="none">
        <Text style={styles.lensBadgeText}>
          picked: {device?.id ?? 'none'} ({device?.type ?? '—'}{device?.isVirtualDevice ? ',virtual' : ''})
          {'\n'}
          AF: {device?.supportsFocusMetering ? 'yes' : 'NO'} · build-tag: decision-log-21
        </Text>
      </View>

      <View style={styles.cameraOverlay} pointerEvents="box-none">
        <Pressable style={styles.gearButton} onPress={goToSettings} accessibilityLabel="Scan settings" hitSlop={8}>
          <Icon name="settings-outline" size={20} color="white" />
        </Pressable>
        {selectionCount > 0 ? (
          <Pressable style={styles.selectionBadge} onPress={goToSelection}>
            <Icon name="layers" size={14} color="white" />
            <Text style={styles.selectionBadgeText}>{selectionCount}</Text>
          </Pressable>
        ) : null}
      </View>

      <DecisionStatusPill />

      <CaptureGallery records={records} onAdd={onAddFromReview} onDismiss={onDismissTile} />

      {/* Bottom-right "done" button — quick path into the Selection screen
          when the user is finished sweeping. */}
      <View style={styles.doneBar} pointerEvents="box-none">
        <Pressable
          onPress={goToSelection}
          style={[
            styles.doneButton,
            selectionCount === 0 && styles.doneButtonDisabled,
          ]}
          disabled={selectionCount === 0}
          accessibilityLabel="Review scanned selection"
        >
          <Icon name="layers-outline" size={18} color={selectionCount === 0 ? 'muted' : 'white'} />
          <Text
            style={[
              styles.doneButtonText,
              selectionCount === 0 && styles.doneButtonTextDisabled,
            ]}
          >
            {selectionCount === 0 ? 'Aim at a card — capturing automatically' : `Review ${selectionCount}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function FrameTheCardHint({
  metrics,
  hasRecords,
}: {
  metrics: ReturnType<typeof useCardDetection>['metrics'];
  hasRecords: boolean;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf: number;
    const loop = () => {
      setTick((n) => (n + 1) & 0xffff);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const m = metrics.getDirty();
  // Hide the hint as soon as detection sees a quad OR the user already has
  // captures in the gallery (they clearly know what they're doing).
  if (m.hasQuad || m.frameSize.width === 0 || hasRecords) return null;

  return (
    <View style={styles.frameHintWrap} pointerEvents="none">
      <Icon name="scan-outline" size={56} tint="rgba(255,255,255,0.45)" />
      <Text style={styles.frameHintText}>Position a card in view</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cameraOverlay: { ...StyleSheet.absoluteFillObject },
  lensBadge: {
    position: 'absolute',
    top: 100,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  lensBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 14,
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
  selectionBadge: {
    position: 'absolute',
    top: 48,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#3b82f6',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectionBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  frameHintWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  frameHintText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  permissionWrap: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  permissionTitle: { color: '#f5f5f5', fontSize: 24, fontWeight: '700' },
  permissionBody: { color: '#cbd1da', fontSize: 14, lineHeight: 20 },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  doneBar: {
    position: 'absolute',
    bottom: 116,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#3b82f6',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  doneButtonDisabled: {
    backgroundColor: 'rgba(8,12,22,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  doneButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  doneButtonTextDisabled: { color: 'rgba(255,255,255,0.6)', fontWeight: '500' },
});
