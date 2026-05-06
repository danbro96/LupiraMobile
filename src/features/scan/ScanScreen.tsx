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
  type CameraRef,
  useCameraDevices,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';
import { CommonResolutions } from 'react-native-vision-camera';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
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
import { GuideFrame } from './components/GuideFrame';
import { Icon } from '../../components/Icon';
import { breadcrumb } from '../../observability/breadcrumb';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'Scan'>;
type Route = RouteProp<ScanStackParamList, 'Scan'>;

type CapturedShot = {
  uri: string;
  cropped: boolean;
  /** Width of the *source* photo (pre-crop) in pixels. */
  sourceWidth: number;
  /** Height of the *source* photo (pre-crop) in pixels. */
  sourceHeight: number;
};

export function ScanScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      breadcrumb('appstate', `transition`, { from: AppState.currentState, to: next });
      setAppState(next);
    });
    return () => sub.remove();
  }, []);
  const { hasPermission, requestPermission } = useCameraPermission();
  // Lens choice. Earlier attempts (`useCameraDevice('back', { physicalDevices:
  // ['wide-angle'] })`) returned a *logical* multicam device on Galaxy S23
  // that reported `supportsFocusMetering: false` — meaning our explicit
  // focusTo call silently threw and AF never engaged for capture. The fix is
  // to enumerate every back camera and explicitly pick a *single-physical*
  // wide-angle lens that actually exposes focus metering. We sort all back
  // candidates with focus-metering-capable wide-angles first, then anything
  // else with metering, then anything at all as a last resort.
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
  // Maximum-quality capture configuration. We can dial perf-vs-quality back
  // later, but the current pipeline produced unusably soft stills.
  // - `targetResolution: HIGHEST_4_3` asks for the largest sensor mode
  //   available (~50 MP on a Galaxy S23 main lens). The default UHD_4_3
  //   (12 MP) was leaving sensor detail on the table.
  // - `qualityPrioritization: 'quality'` makes the capture pipeline wait for
  //   AF/AE to settle instead of snapping the next preview frame (the v5
  //   default leans toward speed; v4's `enableHighQualityPhotos` Camera prop
  //   was the equivalent of this).
  // - `quality: 1` and `containerFormat: 'jpeg'` together pin the in-memory
  //   Photo to its highest-fidelity setting.
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.HIGHEST_4_3,
    qualityPrioritization: 'quality',
    quality: 1,
    containerFormat: 'jpeg',
  });
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
        isFoil: false,
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
  // Forward-references to `detection.resume` / `detection.pause` — used by
  // captureAndScan to (a) silence the worklet before awaiting capturePhoto +
  // cropToQuad so its per-frame OpenCV.clearBuffers() doesn't wipe objects
  // mid-warp, and (b) re-arm detection if the capture short-circuits. Both
  // populated once `detection` is initialised below.
  const resumeDetectionRef = useRef<(() => void) | null>(null);
  const pauseDetectionRef = useRef<(() => void) | null>(null);
  // Latest values of these flags, accessible from the captureAndScan closure
  // without re-creating the callback on every transition.
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const appStateRef = useRef(appState);
  appStateRef.current = appState;

  const captureAndScan = useCallback(
    async (quad: Quad | null, frameSize: FrameSize | null) => {
      if (capturingRef.current) return;
      // Camera2's ImageCapture detaches on AppState/focus changes and re-binds
      // a moment later. A worklet auto-capture queued during that gap will
      // throw "Not bound to a valid Camera". Skip cleanly instead of surfacing
      // the red box.
      if (!isFocusedRef.current || appStateRef.current !== 'active') {
        breadcrumb('capture', 'capture_skipped_inactive', {
          isFocused: isFocusedRef.current,
          appState: appStateRef.current,
        });
        resumeDetectionRef.current?.();
        return;
      }
      capturingRef.current = true;
      setCapturing(true);
      // Silence the worklet before any OpenCV-using awaits. Both the worklet
      // and cropToQuad share fast-opencv's global object store; if the worklet
      // keeps running, its per-frame clearBuffers() wipes objects cropToQuad
      // is mid-way through, throwing "Object with id … not found in storage".
      pauseDetectionRef.current?.();
      breadcrumb('capture', 'capture_start', {
        hasQuad: !!quad,
        frameW: frameSize?.width ?? 0,
        frameH: frameSize?.height ?? 0,
      });
      let photo: Awaited<ReturnType<typeof photoOutput.capturePhoto>> | null = null;
      try {
        // Explicitly trigger AF to the centre of the preview and wait for it
        // to settle before snapping. CameraX on Android does NOT reliably
        // honour `qualityPrioritization: 'quality'` for focus-locking the way
        // iOS does — the result is that capturePhoto grabs the next available
        // frame, blurry or not, even with continuous AF running. Forcing a
        // synchronous focusTo before capture gives the lens motor time to
        // converge, which is the difference between a sharp scan and the
        // soft mess we were seeing.
        const cw = containerSize.width;
        const ch = containerSize.height;
        if (cameraRef.current && cw > 0 && ch > 0) {
          try {
            breadcrumb('capture', 'focus_lock_start', { x: cw / 2, y: ch / 2 });
            await cameraRef.current.focusTo({ x: cw / 2, y: ch / 2 }, { modes: ['AF', 'AE'] });
            // Tiny tail-end settle. focusTo's promise resolves when the AF
            // routine reports done, but on some Android stacks the lens is
            // still micro-adjusting for a frame or two after that signal.
            await new Promise((r) => setTimeout(r, 80));
            breadcrumb('capture', 'focus_lock_done');
          } catch (e: unknown) {
            // Some lens/device combos report `supportsFocusMetering: false`
            // and throw here. Continuous AF will still be running in the
            // background — fall through to capture.
            const msg = e instanceof Error ? e.message : String(e);
            breadcrumb('capture', 'focus_lock_skip', { error: msg }, 'warning');
          }
        }
        try {
          // `enableDistortionCorrection` undoes the wide-angle barrel curve
          // that bows straight card edges in the corners — important because
          // we're feeding the photo into a perspective warp that assumes the
          // card edges are straight lines. Without it, OCR on edge text drifts.
          photo = await photoOutput.capturePhoto(
            { flashMode: 'off', enableShutterSound: false, enableDistortionCorrection: true },
            {},
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          // ImageCapture throws this when it's between camera bindings (typical
          // after AppState transitions). Recover silently — the user can try
          // again now that the binding has settled.
          if (msg.includes('Not bound to a valid Camera') || msg.includes('not bound')) {
            breadcrumb('capture', 'capture_camera_unbound', { error: msg }, 'warning');
            resumeDetectionRef.current?.();
            return;
          }
          throw err;
        }
        breadcrumb('capture', 'capture_taken', {
          width: photo.width,
          height: photo.height,
        });
        // v5 photos are in-memory; persist to a temp file so cropToQuad and the
        // multipart upload can both consume a `file://` URI as before.
        const tempPath = await photo.saveToTemporaryFileAsync();
        const photoUri = tempPath.startsWith('file://') ? tempPath : `file://${tempPath}`;
        const photoWidth = photo.width;
        const photoHeight = photo.height;

        let uploadUri = photoUri;
        let cropped = false;
        if (quad && frameSize) {
          breadcrumb('crop', 'crop_start', {
            photoW: photoWidth,
            photoH: photoHeight,
            quality: settings.jpegQuality,
          });
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
            cropped = true;
            breadcrumb('crop', 'crop_done', {
              outputW: result.width,
              outputH: result.height,
            });
          } catch (e) {
            console.warn('cropToQuad failed, falling back to uncropped upload', e);
            breadcrumb('crop', 'crop_failed', { error: String(e) }, 'warning');
          }
        } else {
          breadcrumb('crop', 'crop_skipped', { reason: !quad ? 'no_quad' : 'no_frame_size' });
        }

        if (settings.previewBeforeUpload) {
          breadcrumb('navigation', 'route_to_preview', { uri: uploadUri, cropped });
          navigation.navigate('ScanPreview', {
            uri: uploadUri,
            cropped,
            originalUri: photoUri,
            sourceWidth: photoWidth,
            sourceHeight: photoHeight,
          });
        } else {
          breadcrumb('upload', 'upload_start', { cropped, uri: uploadUri });
          setShot({ uri: uploadUri, cropped, sourceWidth: photoWidth, sourceHeight: photoHeight });
          scan.mutate(uploadUri);
        }
      } finally {
        photo?.dispose();
        capturingRef.current = false;
        setCapturing(false);
      }
    },
    [navigation, photoOutput, scan, settings.jpegQuality, settings.previewBeforeUpload],
  );

  // After ScanPreview confirms, it navigates back here with the URI in params.
  // Pick it up, fire the mutation, and clear the param so we don't re-fire on
  // future re-renders.
  useEffect(() => {
    const pending = route.params?.pendingUpload;
    if (!pending) return;
    setShot({ uri: pending.uri, cropped: pending.cropped, sourceWidth: 0, sourceHeight: 0 });
    scan.mutate(pending.uri);
    navigation.setParams({ pendingUpload: undefined });
  }, [route.params?.pendingUpload, navigation, scan]);

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
  resumeDetectionRef.current = detection.resume;
  pauseDetectionRef.current = detection.pause;

  const onManualCapture = useCallback(() => {
    void captureAndScan(detection.quad.getDirty(), detection.metrics.getDirty().frameSize);
  }, [captureAndScan, detection.quad, detection.metrics]);

  // Bridge worklet-thread state into Sentry breadcrumbs. The worklet body
  // can't call Sentry directly (different thread, different runtime), but we
  // can sample its `lastStep` / `lastError` from the JS thread and emit a
  // breadcrumb when either changes. This is the load-bearing piece for
  // diagnosing native crashes — when the process dies inside the OpenCV
  // pipeline, the most-recent breadcrumb tells us which step was running.
  const lastSampledStep = useRef<string>('');
  const lastSampledError = useRef<string>('');
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
          `worklet_error`,
          { error: m.lastError, lastStep: m.lastStep, framesProcessed: m.framesProcessed },
          'error',
        );
      }
    }, 500);
    return () => clearInterval(id);
  }, [detection.metrics]);

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

  if (!device) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={styles.center} />
      </SafeAreaView>
    );
  }

  // The Camera and `useCardDetection` stay mounted across the entire scan→
  // result→retake cycle. Earlier we returned a separate result-screen tree
  // when `shot` was set, which unmounted the Camera and detached the frame
  // output — and on retake the new mount apparently never re-bound the worklet
  // (detection silently stayed off until app restart). Keeping a single mount
  // and toggling `isActive` avoids that whole class of bug.
  return (
    <View style={styles.container} onLayout={onCameraLayout}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isFocused && appState === 'active' && !shot}
        outputs={[photoOutput, detection.frameOutput]}
        // Tap anywhere on the preview → snap AF/AE/AWB to that point. Useful
        // backup when continuous AF can't lock on a featureless surface.
        enableNativeTapToFocusGesture
      />

      {!shot && containerSize.width > 0 ? (
        <>
          <GuideFrame containerWidth={containerSize.width} containerHeight={containerSize.height} />
          <DetectionOverlay
            quad={detection.quad}
            metrics={detection.metrics}
            stableFrames={detection.stableFrames}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            threshold={overlayThreshold}
            minStableFrames={overlayMinFrames}
          />
        </>
      ) : null}

      {!shot && showDebug ? (
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

      {!shot ? <FrameTheCardHint metrics={detection.metrics} /> : null}

      {!shot ? (
        <View style={styles.lensBadge} pointerEvents="none">
          <Text style={styles.lensBadgeText}>
            picked: {device?.id ?? 'none'} ({device?.type ?? '—'}{device?.isVirtualDevice ? ',virtual' : ''})
            {'\n'}
            AF: {device?.supportsFocusMetering ? 'yes' : 'NO'} · all back: {deviceCandidates.length}
            {'\n'}
            {deviceCandidates
              .map((c) => `${c.device.id}:${c.device.type}${c.hasAF ? '+AF' : ''}${c.device.isVirtualDevice ? '(v)' : ''}`)
              .join(' | ')}
            {'\n'}
            build-tag: lens-enum-17
          </Text>
        </View>
      ) : null}

      {!shot ? (
        <View style={styles.cameraOverlay} pointerEvents="box-none">
          <View style={styles.captureBar}>
            <Pressable
              onPress={onManualCapture}
              style={styles.shutter}
              accessibilityLabel="Capture card"
            >
              <Icon name="camera" size={28} color="primary" />
            </Pressable>
          </View>
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
      ) : null}

      {shot ? (
        <SafeAreaView style={[StyleSheet.absoluteFill, styles.resultOverlay]} edges={['bottom']}>
          <ScrollView contentContainerStyle={styles.resultScrollSticky}>
            <Image source={{ uri: shot.uri }} style={styles.resultPreview} resizeMode="contain" />

            <View style={styles.resultMetaRow}>
              <View style={[styles.chip, shot.cropped ? styles.chipSuccess : styles.chipWarning]}>
                <Icon
                  name={shot.cropped ? 'crop' : 'image-outline'}
                  size={12}
                  color={shot.cropped ? 'success' : 'warning'}
                />
                <Text style={[styles.chipText, { color: shot.cropped ? '#22c55e' : '#f59e0b' }]}>
                  {shot.cropped ? 'cropped' : 'raw frame'}
                </Text>
              </View>
              {shot.sourceWidth > 0 ? (
                <View style={[styles.chip, styles.chipNeutral]}>
                  <Icon name="resize-outline" size={12} tint="#9aa3b2" />
                  <Text style={[styles.chipText, { color: '#9aa3b2' }]}>
                    src {shot.sourceWidth}×{shot.sourceHeight} ({((shot.sourceWidth * shot.sourceHeight) / 1_000_000).toFixed(1)} MP)
                  </Text>
                </View>
              ) : null}
            </View>

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
          </ScrollView>

          <View style={styles.stickyActions}>
            <Pressable onPress={onRetake} style={styles.secondaryButton}>
              <Icon name="arrow-undo-outline" size={18} color="primary" />
              <Text style={styles.secondaryButtonText}>Retake</Text>
            </Pressable>
            <Pressable onPress={goToSelection} style={styles.primaryButton}>
              <Icon name="layers-outline" size={18} color="white" />
              <Text style={styles.primaryButtonText}>
                Selection{selectionCount > 0 ? ` (${selectionCount})` : ''}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

function FrameTheCardHint({ metrics }: { metrics: ReturnType<typeof useCardDetection>['metrics'] }) {
  // Re-render at rAF cadence to track the worklet shared value cheaply.
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
  if (m.hasQuad || m.frameSize.width === 0) return null;

  return (
    <View style={styles.frameHintWrap} pointerEvents="none">
      <Icon name="scan-outline" size={56} tint="rgba(255,255,255,0.45)" />
      <Text style={styles.frameHintText}>Position a card in view</Text>
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
        <Icon name="add-circle" size={16} color="white" />
        <Text style={styles.addButtonText}>Add</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cameraOverlay: { ...StyleSheet.absoluteFillObject },
  lensBadge: {
    position: 'absolute',
    bottom: 140,
    left: 12,
    right: 12,
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
  captureBar: { position: 'absolute', bottom: 48, alignSelf: 'center', left: 0, right: 0, alignItems: 'center' },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
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
  resultScroll: { padding: 16, gap: 16 },
  /** Same as resultScroll but pads the bottom for the sticky action bar. */
  resultScrollSticky: { padding: 16, gap: 16, paddingBottom: 96 },
  /**
   * Opaque background for the result UI when it's overlaying the still-mounted
   * Camera. We keep the Camera mounted across capture/retake so the worklet
   * frame output never re-binds; the result panel just sits on top.
   */
  resultOverlay: { backgroundColor: '#0e1117' },
  resultPreview: { width: '100%', height: 280, borderRadius: 12, backgroundColor: '#1a1f29' },
  resultMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipSuccess: { backgroundColor: '#16331f', borderColor: '#22c55e' },
  chipWarning: { backgroundColor: '#33231a', borderColor: '#f59e0b' },
  chipNeutral: { backgroundColor: '#1a1f29', borderColor: '#2c3340' },
  chipText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
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
  /** Sticky bottom action bar floating over the result-screen ScrollView. */
  stickyActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: 'rgba(14, 17, 23, 0.95)',
    borderTopWidth: 1,
    borderTopColor: '#1a1f29',
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderColor: '#3b82f6',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: '#3b82f6', fontSize: 16, fontWeight: '600' },
});
