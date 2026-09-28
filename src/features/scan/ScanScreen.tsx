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
import { ImpactFeedbackStyle } from 'expo-haptics';
import { Camera, useCameraDevices, useCameraPermission } from 'react-native-vision-camera';
import { useQueryClient } from '@tanstack/react-query';
import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { File } from 'expo-file-system';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApiError } from '../../api/mutator';
import { scanCard } from '../../api/scan';
import type { CardCandidateDto, ScanResponse } from '../../api/generated/models';
import { ScanStackParamList } from '../../navigation/types';
import { useCurrentSelection, useCurrentSelectionQuery } from './useCurrentSelection';
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
import { CaptureReviewModal } from './components/CaptureReviewModal';
import { DecisionStatusPill } from './components/DecisionStatusPill';
import { ScanBanner, type ScanBannerState } from './components/ScanBanner';
import {
  captureQueueReducer,
  needsReview,
  newCaptureId,
  type CaptureId,
  type CaptureRecord,
} from './captureQueueReducer';
import { addEntry, DEFAULT_ATTRIBUTES, removeEntries, replaceEntries } from './selectionEdits';
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
import { hapticImpact, hapticSuccess } from '../../feedback/haptics';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'Scan'>;
type Route = RouteProp<ScanStackParamList, 'Scan'>;

export function ScanScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
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

  // Explicitly pick a single-physical wide-angle with focus metering: the simpler
  // `useCameraDevice('back', { physicalDevices: ['wide-angle'] })` returned a logical
  // multicam on Galaxy S23 that reported supportsFocusMetering:false.
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
  const selectionQuery = useCurrentSelectionQuery(currentSelectionId);

  // `ensure` is re-created every render; a ref keeps the upload callbacks (and so the worklet's
  // onAutoCapture) stable.
  const ensureSelectionRef = useRef(ensureSelection);
  ensureSelectionRef.current = ensureSelection;
  const selectionCardsRef = useRef(selectionQuery.data?.cards);
  selectionCardsRef.current = selectionQuery.data?.cards;

  const [records, dispatch] = useReducer(captureQueueReducer, [] as CaptureRecord[]);
  const recordsRef = useRef(records);
  recordsRef.current = records;

  const [banner, setBanner] = useState<ScanBannerState | null>(null);
  const showBanner = useCallback((b: Omit<ScanBannerState, 'nonce'>) => {
    setBanner((prev) => ({ ...b, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);
  const hideBanner = useCallback(() => setBanner(null), []);
  const [flashKey, setFlashKey] = useState(0);

  const invalidateSelection = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['selection'] }),
    [queryClient],
  );

  const addCandidate = useCallback(
    async (id: CaptureId, candidate: CardCandidateDto, allowDuplicate: boolean) => {
      const selectionId = await ensureSelectionRef.current();
      const entry = await addEntry(selectionId, candidate.printing.id, DEFAULT_ATTRIBUTES, {
        confidence: candidate.combinedScore,
        allowDuplicate,
      });
      dispatch({ type: 'capture/added', id, added: { printingId: candidate.printing.id, instanceId: entry.instanceId } });
      invalidateSelection();
      return { selectionId, instanceId: entry.instanceId };
    },
    [invalidateSelection],
  );

  const undoAdd = useCallback(
    async (id: CaptureId, selectionId: string, instanceId: string) => {
      try {
        await removeEntries(selectionId, [instanceId]);
        dispatch({ type: 'capture/unadded', id });
        invalidateSelection();
      } catch (err: unknown) {
        toastError((err as Error).message);
      }
    },
    [invalidateSelection],
  );

  const autoAdd = useCallback(
    async (id: CaptureId, top: CardCandidateDto) => {
      try {
        const { selectionId, instanceId } = await addCandidate(id, top, false);
        hapticSuccess();
        showBanner({
          tone: 'success',
          message: `${top.printing.name} added`,
          action: { label: 'Undo', onPress: () => void undoAdd(id, selectionId, instanceId) },
        });
        traceScan('add', `auto-added ${top.printing.name}`, { captureId: id });
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 409) {
          traceScan('add', 'auto-add skipped: already in selection', { captureId: id, level: 'debug' });
          showBanner({
            tone: 'info',
            message: `${top.printing.name} is already in the selection`,
            action: {
              label: 'Add another',
              onPress: () => void addCandidate(id, top, true).then(hapticSuccess, (e: Error) => toastError(e.message)),
            },
          });
          return;
        }
        traceScan('add', 'auto-add failed', { captureId: id, level: 'warning', data: describeError(err) });
      }
    },
    [addCandidate, showBanner, undoAdd],
  );

  const appendDecisionLog = useDecisionLog((s) => s.append);

  const cameraActive = isFocused && appState === 'active';
  const cameraActiveRef = useRef(cameraActive);
  cameraActiveRef.current = cameraActive;

  // Uploads run one at a time: the OCR backend processes one image at a time, so parallel scans only
  // queue there and hit its 30 s timeout. Waiting here keeps every request inside the timeout.
  const uploadChain = useRef<Promise<void>>(Promise.resolve());
  const uploadsPending = useRef(0);

  const upload = useCallback(
    async (id: CaptureId, captureUri: string, queuedAt: number) => {
      const uploadStartedAt = Date.now();
      const queueMs = uploadStartedAt - queuedAt;
      try {
        const response = await scanCard(captureUri);
        traceScan('result', `${response.confidence} · ${response.candidates[0]?.printing.name ?? 'no match'}`, {
          captureId: id,
          level: response.candidates.length === 0 ? 'warning' : 'info',
          data: { queueMs, uploadMs: Date.now() - uploadStartedAt, ...summariseScanResponse(response) },
        });
        dispatch({ type: 'capture/recognised', id, response });

        // Lower-confidence captures stay staged for tap-to-confirm review. Awaited so selection writes
        // stay serial with the upload chain (concurrent first adds would each create a selection).
        if (response.confidence === 'High' && response.candidates.length > 0) {
          await autoAdd(id, response.candidates[0]);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        traceScan('upload', 'scan request failed', {
          captureId: id,
          level: 'error',
          data: { queueMs, uploadMs: Date.now() - uploadStartedAt, ...describeError(err) },
        });
        dispatch({ type: 'capture/error', id, message: msg });
      }
    },
    [autoAdd],
  );

  const enqueueUpload = useCallback(
    async (id: CaptureId, captureUri: string) => {
      const queuedAt = Date.now();
      const ahead = uploadsPending.current++;
      traceScan('upload', ahead > 0 ? `queued behind ${ahead}` : 'POST /scans', { captureId: id, level: 'debug' });
      const run = uploadChain.current.then(() => upload(id, captureUri, queuedAt));
      uploadChain.current = run;
      await run;
      uploadsPending.current--;
    },
    [upload],
  );

  const captureAndScan = useCallback(
    async (captureUri: string, quad: Quad, frameSize: FrameSize, diag: CaptureDiagnostics) => {
      const id: CaptureId = newCaptureId();
      const m = diag.metrics;
      appendDecisionLog(
        buildLogEntry(m, { kind: 'fired', quadCentroid: { x: (quad[0].x + quad[2].x) / 2, y: (quad[0].y + quad[2].y) / 2 } }),
      );
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
        return;
      }

      logCropFile(id, captureUri, diag.warpMs);
      dispatch({ type: 'capture/add', id, createdAt: Date.now(), uri: captureUri });
      setFlashKey((k) => k + 1);
      hapticImpact(ImpactFeedbackStyle.Light);

      await enqueueUpload(id, captureUri);
    },
    [appendDecisionLog, enqueueUpload],
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
  useEffect(() => {
    traceScan('camera', cameraActive ? 'camera active' : 'camera inactive', {
      level: 'debug',
      data: { focused: isFocused, appState },
    });
  }, [cameraActive, isFocused, appState]);

  const lastSampledStep = useRef<string>('');
  const lastSampledError = useRef<string>('');
  const lastSampledFormat = useRef<string>('');
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

  const [reviewing, setReviewing] = useState<{ id: CaptureId; queue: boolean } | null>(null);
  const [pickPending, setPickPending] = useState(false);
  const reviewingRecord = reviewing ? records.find((r) => r.id === reviewing.id) ?? null : null;
  const pendingReview = records.filter(needsReview);
  const remainingInQueue = reviewing?.queue ? pendingReview.filter((r) => r.id !== reviewing.id).length : 0;

  const startReviewQueue = () => {
    const first = [...pendingReview].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (first) setReviewing({ id: first.id, queue: true });
  };

  const finishReview = useCallback((doneId: CaptureId) => {
    setReviewing((current) => {
      if (!current?.queue) return null;
      const next = recordsRef.current
        .filter((r) => r.id !== doneId && needsReview(r))
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      return next ? { id: next.id, queue: true } : null;
    });
  }, []);

  const onPick = useCallback(
    async (record: CaptureRecord, candidate: CardCandidateDto) => {
      if (record.state.kind !== 'recognised') return;
      const previous = record.state.added;
      setPickPending(true);
      try {
        if (previous) {
          // The cache can lag a just-auto-added entry, so fall back to defaults rather than skipping the swap.
          const attrs = selectionCardsRef.current?.find((e) => e.instanceId === previous.instanceId) ?? DEFAULT_ATTRIBUTES;
          const selectionId = await ensureSelectionRef.current();
          const [instanceId] = await replaceEntries(selectionId, [previous.instanceId], candidate.printing.id, attrs);
          dispatch({ type: 'capture/added', id: record.id, added: { printingId: candidate.printing.id, instanceId } });
          invalidateSelection();
        } else {
          try {
            await addCandidate(record.id, candidate, false);
          } catch (err: unknown) {
            if (!(err instanceof ApiError && err.status === 409)) throw err;
            const again = await confirm({
              title: 'Already in selection',
              message: `${candidate.printing.name} is already in your selection. Add another copy?`,
              confirmLabel: 'Add another',
            });
            if (!again) return;
            await addCandidate(record.id, candidate, true);
          }
        }
        hapticSuccess();
        finishReview(record.id);
      } catch (err: unknown) {
        toastError((err as Error).message);
      } finally {
        setPickPending(false);
      }
    },
    [addCandidate, confirm, finishReview, invalidateSelection],
  );

  const onDiscard = useCallback(
    async (record: CaptureRecord) => {
      const added = record.state.kind === 'recognised' ? record.state.added : undefined;
      if (added) {
        try {
          await removeEntries(await ensureSelectionRef.current(), [added.instanceId]);
          invalidateSelection();
        } catch (err: unknown) {
          toastError((err as Error).message);
          return;
        }
      }
      finishReview(record.id);
      dispatch({ type: 'capture/dismiss', id: record.id });
    },
    [finishReview, invalidateSelection],
  );

  const onSearchManually = (record: CaptureRecord) => {
    if (record.state.kind !== 'recognised') return;
    const { response } = record.state;
    const query = response.debug.zones.name.trim() || response.candidates[0]?.printing.name || '';
    setReviewing(null);
    navigation.navigate('PrintingPicker', { query, captureId: record.id });
  };

  const manualMatch = route.params?.manualMatch;
  useEffect(() => {
    if (!manualMatch) return;
    dispatch({
      type: 'capture/added',
      id: manualMatch.captureId,
      added: { printingId: manualMatch.printingId, instanceId: manualMatch.instanceId },
    });
    navigation.setParams({ manualMatch: undefined });
  }, [manualMatch, navigation]);

  const onRetry = useCallback(
    (id: CaptureId) => {
      const record = recordsRef.current.find((r) => r.id === id);
      if (record?.state.kind !== 'error' || !record.state.uri) return;
      traceScan('upload', 'retry', { captureId: id });
      dispatch({ type: 'capture/retry', id });
      void enqueueUpload(id, record.state.uri);
    },
    [enqueueUpload],
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

  const showDebug = settings.showDebugOverlay;

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
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={cameraActive}
        outputs={[detection.frameOutput]}
        enableNativeTapToFocusGesture
        onStarted={() => traceScan('camera', 'session started')}
        onStopped={() => traceScan('camera', 'session stopped', { level: 'debug' })}
        onError={(e) => traceScan('camera', 'session error', { level: 'error', data: { error: e.message } })}
        onInterruptionStarted={(reason) => traceScan('camera', 'interrupted', { level: 'warning', data: { reason } })}
        onInterruptionEnded={() => traceScan('camera', 'interruption ended')}
      />

      {containerSize.width > 0 ? (
        <>
          <GuideFrame containerWidth={containerSize.width} containerHeight={containerSize.height} flashKey={flashKey} />
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
          />
        </ErrorBoundary>
      ) : null}

      {showDebug ? (
        <View style={styles.lensBadge} pointerEvents="none">
          <Text style={styles.lensBadgeText}>
            picked: {device.id} ({device.type}{device.isVirtualDevice ? ',virtual' : ''})
            {'\n'}
            AF: {device.supportsFocusMetering ? 'yes' : 'NO'}
          </Text>
        </View>
      ) : null}

      <ScanBanner banner={banner} onHide={hideBanner} />

      <DecisionStatusPill showDebug={showDebug} />

      <View style={styles.actionBar} pointerEvents="box-none">
        {pendingReview.length > 0 ? (
          <Pressable
            onPress={startReviewQueue}
            style={[styles.actionPill, styles.reviewPill]}
            accessibilityLabel={`Review ${pendingReview.length} uncertain scans`}
          >
            <MaterialIcons name={ICONS.help} size={18} color={darkColors.bg} />
            <Text style={styles.reviewPillText}>{pendingReview.length} to review</Text>
          </Pressable>
        ) : null}
        {selectionCount > 0 ? (
          <Pressable
            onPress={goToSelection}
            style={[styles.actionPill, styles.selectionPill]}
            accessibilityLabel={`Open selection, ${selectionCount} cards`}
          >
            <MaterialIcons name={ICONS.layers} size={18} color={darkColors.onPrimary} />
            <Text style={styles.selectionPillText}>Selection · {selectionCount}</Text>
            <MaterialIcons name={ICONS.chevronRight} size={18} color={darkColors.onPrimary} />
          </Pressable>
        ) : null}
      </View>

      <CaptureGallery records={records} onOpen={(id) => setReviewing({ id, queue: false })} onRetry={onRetry} onDismiss={onDismissTile} />

      <CaptureReviewModal
        record={reviewingRecord}
        remaining={remainingInQueue}
        showScores={showDebug}
        pending={pickPending}
        onPick={(candidate) => reviewingRecord && void onPick(reviewingRecord, candidate)}
        onSearch={() => reviewingRecord && onSearchManually(reviewingRecord)}
        onDiscard={() => reviewingRecord && void onDiscard(reviewingRecord)}
        onClose={() => setReviewing(null)}
      />
    </View>
  );
}

function logCropFile(captureId: string, uri: string, warpMs: number) {
  try {
    const file = new File(uri);
    const exists = file.exists;
    traceScan('crop', 'crop saved', {
      captureId,
      level: exists ? 'debug' : 'error',
      data: { uri, exists, bytes: exists ? file.size : 0, warpMs },
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    permissionWrap: { flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
    permissionBody: { color: c.textMuted },
  });

// Camera HUD: always dark regardless of scheme.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  // Just above CaptureGallery (bottom 16 + tile + caption).
  actionBar: {
    position: 'absolute',
    bottom: 128,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  reviewPill: { backgroundColor: darkColors.warning },
  reviewPillText: { color: darkColors.bg, fontSize: 14, fontWeight: '700' },
  selectionPill: { backgroundColor: darkColors.primary },
  selectionPillText: { color: darkColors.onPrimary, fontSize: 14, fontWeight: '700' },
});
