import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AppState,
  AppStateStatus,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
import * as FileSystem from 'expo-file-system/legacy';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApiError } from '../../api/mutator';
import {
  getSelection,
  createSelectionCard,
} from '../../api/generated/selections/selections';
import { scanCard } from '../../api/scan';
import type { CardCandidateDto, ScanResponse } from '../../api/generated/models';
import { ScanStackParamList } from '../../navigation/types';
import { useCurrentSelection } from './useCurrentSelection';
import { useScanSettings } from '../../store/scan-settings-store';
import {
  type CaptureDiagnostics,
  type FrameSize,
  type Quad,
  useCardDetection,
} from './detection/useCardDetection';
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
import { breadcrumb } from '../../observability/breadcrumb';
import { traceScan } from './scanTraceStore';
import { ICONS } from '../../ui/icons';
import { darkColors, spacing, useColors, type Palette } from '../../ui/theme';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/ConfirmDialog';
import { toastError } from '../../feedback/toast';
import { hapticSuccess } from '../../feedback/haptics';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'Scan'>;

export function ScanScreen() {
  const navigation = useNavigation<Nav>();
  const c = useColors();
  const themed = useMemo(() => makeStyles(c), [c]);
  const confirm = useConfirm();
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
  useEffect(() => {
    if (!device) return;
    traceScan('camera', 'device selected', {
      data: {
        id: device.id,
        type: device.type,
        virtual: device.isVirtualDevice,
        focusMetering: device.supportsFocusMetering,
        backCandidates: deviceCandidates.map((d) => `${d.device.id}:${d.device.type}${d.hasAF ? '+AF' : ''}`),
      },
    });
  }, [device, deviceCandidates]);

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
    queryFn: () => getSelection(currentSelectionId!),
    enabled: !!currentSelectionId,
  });

  const addToSelection = useMutation({
    mutationFn: async (input: { candidate: CardCandidateDto; allowDuplicate: boolean }) => {
      const selectionId = await ensureSelection();
      return createSelectionCard(selectionId, {
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

  // Capture queue. Each in-flight scan is a record in this list; the gallery
  // renders the list directly. Concurrency safety lives entirely in the
  // reducer — the orchestration code below is fire-and-forget per record.
  const [records, dispatch] = useReducer(captureQueueReducer, [] as ReturnType<typeof captureQueueReducer>);

  // Decision-log store handle. We pull `append` once into a ref-style local
  // because zustand's hook returns a fresh function reference per render,
  // and `captureAndScan` shouldn't capture stale ones.
  const appendDecisionLog = useDecisionLog((s) => s.append);

  // Forward refs to detection.pause/resume — captureAndScan is defined before
  // the detection hook is initialised, so we wire these up after.
  const resumeDetectionRef = useRef<(() => void) | null>(null);
  const pauseDetectionRef = useRef<(() => void) | null>(null);
  // AppState/isFocused snapshots, accessible from the captureAndScan closure
  // without re-creating the callback on every transition.
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const appStateRef = useRef(appState);
  appStateRef.current = appState;
  const cameraActiveRef = useRef(false);
  cameraActiveRef.current = isFocused && appState === 'active';
  // Single concurrent capture lock. fast-opencv's global object store cannot
  // tolerate two cropToQuad calls in flight, and the worklet must be paused
  // while either runs.
  const capturingRef = useRef(false);

  const captureAndScan = useCallback(
    async (captureUri: string, quad: Quad, frameSize: FrameSize, diag: CaptureDiagnostics) => {
      const id: CaptureId = newCaptureId();
      const m = diag.metrics;
      const cx = (quad[0].x + quad[2].x) / 2;
      const cy = (quad[0].y + quad[2].y) / 2;
      appendDecisionLog(buildLogEntry(m, { kind: 'fired', quadCentroid: { x: cx, y: cy } }));
      const s = useScanSettings.getState();
      traceScan('fire', 'auto-capture fired', {
        captureId: id,
        data: {
          score: m.score,
          stability: m.stability,
          sharpness: m.sharpness,
          sharpnessRaw: diag.sharpnessRaw,
          coverage: m.coverage,
          brightness: m.brightness,
          stableFrames: diag.stableFrames,
          fps: m.detectionFps,
          frame: `${frameSize.width}x${frameSize.height}`,
          buffer: `${diag.bufferSize.width}x${diag.bufferSize.height}`,
          roi: diag.roi,
          bufferQuad: diag.bufferQuad.map((p) => [Math.round(p.x), Math.round(p.y)]),
          orientation: m.orientation,
          mirrored: m.isMirrored,
          threshold: s.captureThreshold,
          minStableFrames: s.minStableFrames,
          weights: [s.weightStability, s.weightSharpness, s.weightCoverage, s.weightBrightness],
        },
      });

      // Empty URI = worklet's warp/save step failed. Don't surface a tile, let the next stable frame retry.
      if (!captureUri) {
        traceScan('crop', 'warp/encode failed', {
          captureId: id,
          level: 'error',
          data: { error: diag.error, warpMs: diag.warpMs },
        });
        resumeDetectionRef.current?.();
        return;
      }
      if (capturingRef.current) {
        // Two triggers fired before the previous upload kicked off — drop.
        // The worklet's content cooldown will keep ignoring this card for a
        // moment longer.
        traceScan('fire', 'dropped: previous capture still starting', { captureId: id, level: 'warning' });
        return;
      }

      capturingRef.current = true;
      void logCropFile(id, captureUri, diag.warpMs);

      // The worklet has already produced the canonical card-crop JPEG and
      // handed us the URI. No photoOutput round-trip, no JS-side cropToQuad
      // — what the worklet approved IS what's about to be uploaded. Zero
      // temporal gap between detection and "shutter."
      dispatch({ type: 'capture/start', id, createdAt: Date.now() });
      dispatch({
        type: 'capture/uploading',
        id,
        uri: captureUri,
        // Source dims of the *capture* are the worklet's frame dims (not the
        // canonical output dims) — that's what the gallery tile's "src" chip
        // tries to convey.
        sourceWidth: frameSize.width,
        sourceHeight: frameSize.height,
      });

      // Reopen the worklet immediately so the user can sweep to the next
      // card while this upload is in flight.
      capturingRef.current = false;
      resumeDetectionRef.current?.();

      // Fire-and-forget the upload.
      const uploadStartedAt = Date.now();
      traceScan('upload', 'POST /scans', { captureId: id, level: 'debug' });
      try {
        const response = await scanCard({
          uri: captureUri,
          mimeType: 'image/jpeg',
          fileName: 'scan.jpg',
        });
        traceScan('result', `${response.confidence} · ${response.candidates[0]?.printing.name ?? 'no match'}`, {
          captureId: id,
          level: response.candidates.length === 0 ? 'warning' : 'info',
          data: { uploadMs: Date.now() - uploadStartedAt, ...summariseScanResponse(response) },
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
              onSuccess: () => {
                traceScan('add', `auto-added ${top.printing.name}`, { captureId: id });
              },
              onError: (err) => {
                if (err instanceof ApiError && err.status === 409) {
                  // Already in the selection — fine, leave the green check
                  // on the tile so the user knows it was matched.
                  traceScan('add', 'auto-add skipped: already in selection', { captureId: id, level: 'debug' });
                  return;
                }
                traceScan('add', 'auto-add failed', {
                  captureId: id,
                  level: 'warning',
                  data: describeError(err),
                });
              },
            },
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        traceScan('upload', 'scan request failed', {
          captureId: id,
          level: 'error',
          data: { uploadMs: Date.now() - uploadStartedAt, ...describeError(err) },
        });
        dispatch({ type: 'capture/error', id, message: msg });
      }
    },
    [addToSelection, appendDecisionLog],
  );

  const onAutoCapture = useCallback(
    (captureUri: string, quad: Quad, frameSize: FrameSize, diag: CaptureDiagnostics) => {
      void captureAndScan(captureUri, quad, frameSize, diag);
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

  const cameraActive = isFocused && appState === 'active';
  useEffect(() => {
    traceScan('camera', cameraActive ? 'camera active' : 'camera inactive', {
      level: 'debug',
      data: { focused: isFocused, appState },
    });
  }, [cameraActive, isFocused, appState]);

  // Sample worklet-thread state into the logs at low frequency.
  const lastSampledStep = useRef<string>('');
  const lastSampledError = useRef<string>('');
  const lastSampledFormat = useRef<string>('');
  // Last decision reason we appended to the log. Used to de-duplicate — a
  // long blocked-sharpness stretch should be one entry, not 60 redundant
  // copies that hide the moment the situation changed.
  const lastSampledReason = useRef<DecisionReason | undefined>(undefined);
  const stall = useRef({ frames: -1, since: 0, reported: false });
  useEffect(() => {
    const id = setInterval(() => {
      const m = detection.metrics.getDirty();
      if (m.lastStep && m.lastStep !== lastSampledStep.current) {
        lastSampledStep.current = m.lastStep;
        // Anything other than a clean pass means frames are being skipped before contour search.
        const abnormal = m.lastStep !== 'done' && m.lastStep !== 'detection-disabled';
        traceScan('worklet', `step=${m.lastStep}`, {
          level: abnormal ? 'warning' : 'debug',
          data: { framesProcessed: m.framesProcessed, contourCount: m.contourCount, edgePixelCount: m.edgePixelCount },
        });
      }
      if (m.lastError && m.lastError !== lastSampledError.current) {
        lastSampledError.current = m.lastError;
        traceScan('worklet', 'pipeline error', {
          level: 'error',
          data: { error: m.lastError, lastStep: m.lastStep, framesProcessed: m.framesProcessed },
        });
      }
      const format = `${m.frameSize.width}x${m.frameSize.height} ${m.pixelFormat} ${m.orientation}${m.isMirrored ? ' mirrored' : ''} planes=${m.planesCount} bpr=${m.bytesPerRow}`;
      if (m.frameSize.width > 0 && format !== lastSampledFormat.current) {
        lastSampledFormat.current = format;
        traceScan('camera', `frame format ${format}`);
      }

      // Frames stopped arriving while the camera should be streaming: frame output detached or worklet hung.
      const now = Date.now();
      if (m.framesProcessed !== stall.current.frames || !cameraActiveRef.current) {
        stall.current = { frames: m.framesProcessed, since: now, reported: false };
      } else if (!stall.current.reported && now - stall.current.since > 3000) {
        stall.current.reported = true;
        traceScan('worklet', 'no frames processed for 3 s while camera active', {
          level: 'warning',
          data: { framesProcessed: m.framesProcessed, lastStep: m.lastStep },
        });
      }

      // Decision-log: derive a structured reason from the current metrics
      // and append on transitions only. `fired` events are appended
      // separately from captureAndScan so they're never lost between ticks.
      const reason = deriveDecisionReason(
        m,
        settings.captureThreshold,
        detection.stableFrames.getDirty(),
        settings.minStableFrames,
      );
      if (!reasonsEqual(lastSampledReason.current, reason)) {
        lastSampledReason.current = reason;
        appendDecisionLog(buildLogEntry(m, reason));
        if (__DEV__) console.log('[scan:decision]', reason);
      }
    }, 500);
    return () => clearInterval(id);
  }, [detection.metrics, detection.stableFrames, settings.captureThreshold, settings.minStableFrames, appendDecisionLog]);

  // Tile add (manual review) — used by the gallery's modal.
  const onAddFromReview = useCallback(
    (id: CaptureId, candidate: CardCandidateDto) => {
      addToSelection.mutate(
        { candidate, allowDuplicate: false },
        {
          onSuccess: () => {
            hapticSuccess();
            dispatch({ type: 'capture/auto-add', id, printingId: candidate.printing.id });
          },
          onError: async (err) => {
            if (err instanceof ApiError && err.status === 409) {
              const again = await confirm({
                title: 'Already in selection',
                message: 'This printing is already in your current selection. Add another copy?',
                confirmLabel: 'Add another',
              });
              if (!again) return;
              addToSelection.mutate(
                { candidate, allowDuplicate: true },
                {
                  onSuccess: () => {
                    hapticSuccess();
                    dispatch({ type: 'capture/auto-add', id, printingId: candidate.printing.id });
                  },
                },
              );
            } else {
              toastError((err as Error).message);
            }
          },
        },
      );
    },
    [addToSelection, confirm],
  );
  const onDismissTile = useCallback((id: CaptureId) => {
    dispatch({ type: 'capture/dismiss', id });
  }, []);

  const selectionCount = selectionQuery.data?.cards.length ?? 0;
  const goToSelection = () => navigation.navigate('Selection');

  const onCameraLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  }, []);

  const showDebug = useMemo(() => settings.showDebugOverlay, [settings.showDebugOverlay]);

  if (!hasPermission) {
    return (
      <View style={themed.screen}>
        <View style={themed.permissionWrap}>
          <Text variant="headlineSmall">Camera access required</Text>
          <Text variant="bodyMedium" style={themed.permissionBody}>
            Lupira MTG uses the camera to scan Magic: The Gathering cards. Tap below to grant access.
          </Text>
          <Button title="Grant access" onPress={() => void requestPermission()} />
        </View>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={themed.screen}>
        <ActivityIndicator style={styles.center} />
      </View>
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
        isActive={cameraActive}
        outputs={[photoOutput, detection.frameOutput]}
        enableNativeTapToFocusGesture
        onStarted={() => traceScan('camera', 'session started')}
        onStopped={() => traceScan('camera', 'session stopped', { level: 'debug' })}
        onError={(e) => traceScan('camera', 'session error', { level: 'error', data: { error: e.message } })}
        onInterruptionStarted={(reason) => traceScan('camera', 'interrupted', { level: 'warning', data: { reason } })}
        onInterruptionEnded={() => traceScan('camera', 'interruption ended')}
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
          AF: {device?.supportsFocusMetering ? 'yes' : 'NO'} · build-tag: worklet-frame-23
        </Text>
      </View>

      <View style={styles.cameraOverlay} pointerEvents="box-none">
        {selectionCount > 0 ? (
          <Pressable style={styles.selectionBadge} onPress={goToSelection}>
            <MaterialIcons name={ICONS.layers} size={14} color={darkColors.onPrimary} />
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
          <MaterialIcons
            name={ICONS.layers}
            size={18}
            color={selectionCount === 0 ? HUD_MUTED : darkColors.onPrimary}
          />
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

async function logCropFile(captureId: string, uri: string, warpMs: number) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    traceScan('crop', 'crop saved', {
      captureId,
      level: info.exists ? 'debug' : 'error',
      data: { uri, exists: info.exists, bytes: info.exists ? info.size : 0, warpMs },
    });
  } catch (e: unknown) {
    traceScan('crop', 'crop stat failed', { captureId, level: 'warning', data: describeError(e) });
  }
}

function summariseScanResponse(r: ScanResponse): Record<string, unknown> {
  const d = r.debug;
  return {
    scanId: r.scanId,
    confidence: r.confidence,
    candidateCount: r.candidates.length,
    top: r.candidates.slice(0, 3).map((c) => ({
      name: c.printing.name,
      set: `${c.printing.setCode} #${c.printing.collectorNumber}`,
      combined: c.combinedScore,
      ocr: c.ocrAggregateScore,
      nameScore: c.nameScore,
      hamming: c.hammingDistance,
      byPHash: c.matchedByPHash,
      byName: c.matchedByName,
    })),
    ocrName: `${d.zones.name} (${d.zones.nameConfidence.toFixed(2)})`,
    ocrTypeLine: `${d.zones.typeLine} (${d.zones.typeLineConfidence.toFixed(2)})`,
    ocrBottom: `${d.zones.bottomMetadata} (${d.zones.bottomMetadataConfidence.toFixed(2)})`,
    setSymbol: d.setSymbol ? `${d.setSymbol.setCode} hd=${d.setSymbol.hammingDistance} s=${d.setSymbol.score.toFixed(2)}` : null,
    pHash: d.imagePHash,
    cropped: d.isCropped,
    cropConfidence: d.cropConfidence,
    cropRotated: d.cropRotated,
    rotationRetried: d.rotationRetried,
    croppedSize: `${d.croppedWidth}x${d.croppedHeight}`,
    ocrRegions: d.ocrRegionCount,
    pHashCandidates: d.pHashCandidateCount,
    ocrCandidates: d.ocrCandidateCount,
    ocrMs: d.ocrLatencyMs,
    pHashMs: d.pHashLatencyMs,
  };
}

function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof ApiError) return { status: err.status, error: err.message.slice(0, 500) };
  return { error: err instanceof Error ? err.message : String(err) };
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
      <MaterialIcons name={ICONS.scan} size={56} color="rgba(255,255,255,0.45)" />
      <Text style={styles.frameHintText}>Position a card in view</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    permissionWrap: { flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
    permissionBody: { color: c.textMuted },
  });

const HUD_MUTED = 'rgba(255,255,255,0.6)';

// Camera HUD: always dark regardless of scheme.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cameraOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  lensBadge: {
    position: 'absolute',
    top: 12,
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
  selectionBadge: {
    position: 'absolute',
    top: 12,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: darkColors.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectionBadgeText: { color: darkColors.onPrimary, fontWeight: '700', fontSize: 13 },
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
    backgroundColor: darkColors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  doneButtonDisabled: {
    backgroundColor: 'rgba(8,12,22,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  doneButtonText: { color: darkColors.onPrimary, fontSize: 14, fontWeight: '700' },
  doneButtonTextDisabled: { color: HUD_MUTED, fontWeight: '500' },
});
