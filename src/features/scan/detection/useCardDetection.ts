import { useEffect, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import {
  type CameraFrameOutput,
  type Frame,
  useFrameOutput,
} from 'react-native-vision-camera';
import { runOnJS, type Synchronizable } from 'react-native-worklets';
import {
  BorderTypes,
  ContourApproximationModes,
  DataTypes,
  DecompTypes,
  InterpolationFlags,
  MorphShapes,
  MorphTypes,
  ObjectType,
  OpenCV,
  RetrievalModes,
} from 'react-native-fast-opencv';
import {
  SCAN_COOLDOWN_CENTROID_FRACTION,
  SCAN_COOLDOWN_MS,
  SCAN_HYSTERESIS,
} from '../../../store/scan-settings-store';
import { useSyncedValue } from './useSyncedValue';

/**
 * Output dimensions for the worklet-emitted card crop, matching what cropToQuad produced so the backend
 * pipeline (pHash + OCR + canonicalisation to ~750 px) sees the shape it always has. The source is the
 * worklet's Y-plane (1280×720 typical), so 1200×1680 is mild upsampling — fine, since the backend
 * re-canonicalises anyway.
 */
const MTG_OUTPUT_WIDTH = 1200;
const MTG_OUTPUT_HEIGHT = 1680;
/** JPEG quality used by `saveMatToFile` inside the worklet (0..1 → 0..100). */
const MTG_OUTPUT_JPEG_QUALITY = 0.92;
/**
 * Cache directory captured at module load. expo-file-system exposes
 * `cacheDirectory` as a static string, so it's safe to inline into the
 * worklet's closure — no JS-thread bridge needed at capture time.
 */
const CACHE_DIR_PREFIX = (FileSystem.cacheDirectory ?? '').replace(/\/$/, '');

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];

export type FrameSize = { width: number; height: number };

export type DetectionMetrics = {
  /** Composite soft score in [0..1]. */
  score: number;
  stability: number;
  sharpness: number;
  coverage: number;
  /** Soft brightness-fit score in [0..1] (penalty curve around [80, 200]). */
  brightnessFit: number;
  /** Raw mean luminance of the detection ROI in [0..255]. */
  brightness: number;
  detectionFps: number;
  frameSize: FrameSize;
  hasQuad: boolean;
  /** True if every per-signal hard floor is currently satisfied. */
  hardFloorPass: boolean;
  /** True if the composite score has entered the hysteresis band. */
  inHysteresis: boolean;
  /** True if a recent capture's content-cooldown is still suppressing fires. */
  cooldownActive: boolean;
  /**
   * Milliseconds remaining on the content-cooldown window. 0 when no cooldown
   * is in effect. Lets the status pill show e.g. "Cooldown 0.8 s" without the
   * JS thread needing to track its own timer.
   */
  cooldownRemainingMs: number;
  pixelFormat: string;
  orientation: string;
  isMirrored: boolean;
  bytesPerRow: number;
  planesCount: number;
  contourCount: number;
  candidateQuadCount: number;
  historyDepth: number;
  edgePixelCount: number;
  largeContourCount: number;
  /** Re-purposed: fill ratio of the largest contour as a 0-100 percentage. */
  bestApproxVertexCount: number;
  bestApproxAspect: number;
  framesProcessed: number;
  lastBufferBytes: number;
  lastError: string;
  lastStep: string;
};

export type CardDetectionParams = {
  enabled: boolean;
  autoCaptureEnabled: boolean;
  threshold: number;
  minStableFrames: number;
  weightStability: number;
  weightSharpness: number;
  weightCoverage: number;
  weightBrightness: number;
  /**
   * Invoked on the JS thread once the worklet has approved a frame AND JPEG-encoded the perspective-corrected
   * crop. `captureUri` is a `file://` URI for that JPEG in cache, uploadable directly — no
   * `photoOutput.capturePhoto`, no JS-side cropToQuad. It may be the empty string if the worklet's warp/encode
   * failed (rare); treat that as a silent miss and let the next stable frame try again.
   */
  onAutoCapture: (captureUri: string, quad: Quad, frameSize: FrameSize) => void;
};

export type CardDetectionState = {
  quad: Synchronizable<Quad | null>;
  metrics: Synchronizable<DetectionMetrics>;
  stableFrames: Synchronizable<number>;
  frameOutput: CameraFrameOutput;
  /**
   * Re-enable detection after the worklet has self-disabled for an auto-capture
   * that subsequently failed (e.g. camera was mid-rebind after an AppState
   * transition and `capturePhoto` threw "Not bound to a valid Camera").
   */
  resume: () => void;
  /**
   * Pause the worklet pipeline from JS. Required around `capturePhoto` +
   * `cropToQuad` because both the worklet and `cropToQuad` call
   * `OpenCV.clearBuffers()` on the same global object store; if the worklet
   * keeps running it wipes objects mid-warp.
   */
  pause: () => void;
};

const INITIAL_METRICS: DetectionMetrics = {
  score: 0,
  stability: 0,
  sharpness: 0,
  coverage: 0,
  brightnessFit: 0,
  brightness: 0,
  detectionFps: 0,
  frameSize: { width: 0, height: 0 },
  hasQuad: false,
  hardFloorPass: false,
  inHysteresis: false,
  cooldownActive: false,
  cooldownRemainingMs: 0,
  pixelFormat: 'unknown',
  orientation: 'unknown',
  isMirrored: false,
  bytesPerRow: 0,
  planesCount: 0,
  contourCount: 0,
  candidateQuadCount: 0,
  historyDepth: 0,
  edgePixelCount: 0,
  largeContourCount: 0,
  bestApproxVertexCount: 0,
  bestApproxAspect: 0,
  framesProcessed: 0,
  lastBufferBytes: 0,
  lastError: '',
  lastStep: '',
};

const MTG_ASPECT = 2.5 / 3.5;
const MTG_SHORT = 2.5;
const MTG_LONG = 3.5;
const ASPECT_TOLERANCE = 0.3;
const MIN_AREA_FRACTION = 0.05;
const FILL_RATIO_MIN = 0.7;
/**
 * Fraction of the buffer's *short* axis that the centred detection-ROI takes.
 * The companion display-side GuideFrame uses the same value so the on-screen
 * guide rectangle aligns with where the worklet actually looks.
 */
export const GUIDE_SHORT_FRACTION = 0.55;
const APPROX_EPSILON_FRACTIONS = [0.02, 0.03, 0.04, 0.05, 0.06] as const;
// Width (long axis) of the downscaled buffer that runs through Canny +
// findContours. Lower is faster — work scales with pixel count.
const DETECT_WIDTH = 360;
const STABILITY_HISTORY = 8;

/**
 * Per-frame blend factor for the displayed/auto-capture quad. Each frame the
 * smoothed corners are `prev * (1 - alpha) + current * alpha`, so the visible
 * polygon glides toward the latest detection instead of snapping to it.
 */
const QUAD_SMOOTH_ALPHA = 0.4;
/** How many missed-detection frames the smoothed quad survives before clearing. */
const QUAD_SMOOTH_GRACE_FRAMES = 2;

// --- Decision-policy hard floors. Each signal must clear its floor every
// frame; a single failure resets the stable counter regardless of composite.
// Exported so the JS-thread debug log can derive *which* floor blocked
// without duplicating the constants.
export const HARD_FLOORS = {
  coverage: 0.2,
  stability: 0.55,
  sharpness: 0.45,
  /** Raw luminance band (0..255) the captured frame must sit inside. */
  brightnessMin: 30,
  brightnessMax: 235,
} as const;

const HARD_FLOOR_COVERAGE = HARD_FLOORS.coverage;
const HARD_FLOOR_STABILITY = HARD_FLOORS.stability;
const HARD_FLOOR_SHARPNESS = HARD_FLOORS.sharpness;
const HARD_FLOOR_BRIGHTNESS_MIN = HARD_FLOORS.brightnessMin;
const HARD_FLOOR_BRIGHTNESS_MAX = HARD_FLOORS.brightnessMax;

/**
 * Sharpness normalisation divisor for the mean-absolute-Laplacian metric. 25 was picked empirically: at the
 * YUV-Y small-Mat resolution with a 3×3 Laplacian kernel, in-focus card scans cluster around ~30–60 and
 * blurred frames sit under ~10, so dividing by 25 maps "definitely in focus" to ≥ 1 (clamped).
 */
const SHARPNESS_NORM_DIVISOR = 25;
/**
 * Stability ceiling as a fraction of the *quad's short edge*: 0.05 accepts up to 5% of the card's short side
 * worth of average corner displacement before stability drops to 0. Relative rather than an absolute pixel
 * ceiling, so hand-steadiness requirements scale with how big the card looks on screen.
 */
const STABILITY_CEILING_FRACTION = 0.05;
/** Minimum effective ceiling in pixels — protects against tiny / degenerate quads. */
const STABILITY_CEILING_MIN = 6;

/**
 * Per-frame card detection pipeline (vision-camera v5 / new arch).
 *
 * Frame disposal is mandatory in v5; the outer `finally` always calls
 * `frame.dispose()`. The OpenCV inner finally always calls `clearBuffers()`.
 */
export function useCardDetection(params: CardDetectionParams): CardDetectionState {
  const quad = useSyncedValue<Quad | null>(null);
  const metrics = useSyncedValue<DetectionMetrics>(INITIAL_METRICS);
  const stableFrames = useSyncedValue<number>(0);
  /** True once `score >= HIGH`; reset only when score drops below LOW. */
  const inBand = useSyncedValue<boolean>(false);
  const history = useSyncedValue<Quad[]>([]);
  const lastFrameAt = useSyncedValue<number>(0);
  const ema = useSyncedValue<number>(0);
  const framesProcessedShared = useSyncedValue<number>(0);
  const smoothedDetQuad = useSyncedValue<Quad | null>(null);
  const smoothMissCount = useSyncedValue<number>(0);
  // Content-cooldown record from the most recent successful auto-capture.
  // Stored in detection-space coordinates (matches `activeQuad`).
  const lastCapture = useSyncedValue<{
    at: number;
    centroidX: number;
    centroidY: number;
    shortEdge: number;
  } | null>(null);

  const tunables = useSyncedValue<{
    enabled: boolean;
    autoCaptureEnabled: boolean;
    /** HIGH threshold of the hysteresis band. LOW is derived as HIGH - 0.12. */
    thresholdHigh: number;
    minStableFrames: number;
    wStability: number;
    wSharpness: number;
    wCoverage: number;
    wBrightness: number;
  }>({
    enabled: params.enabled,
    autoCaptureEnabled: params.autoCaptureEnabled,
    thresholdHigh: params.threshold,
    minStableFrames: params.minStableFrames,
    wStability: params.weightStability,
    wSharpness: params.weightSharpness,
    wCoverage: params.weightCoverage,
    wBrightness: params.weightBrightness,
  });

  useEffect(() => {
    tunables.setBlocking({
      enabled: params.enabled,
      autoCaptureEnabled: params.autoCaptureEnabled,
      thresholdHigh: params.threshold,
      minStableFrames: params.minStableFrames,
      wStability: params.weightStability,
      wSharpness: params.weightSharpness,
      wCoverage: params.weightCoverage,
      wBrightness: params.weightBrightness,
    });
  }, [
    tunables,
    params.enabled,
    params.autoCaptureEnabled,
    params.threshold,
    params.minStableFrames,
    params.weightStability,
    params.weightSharpness,
    params.weightCoverage,
    params.weightBrightness,
  ]);

  const onAutoCaptureRef = useRef(params.onAutoCapture);
  onAutoCaptureRef.current = params.onAutoCapture;

  const triggerAutoCapture = (captureUri: string, q: Quad, size: FrameSize) => {
    onAutoCaptureRef.current(captureUri, q, size);
  };

  // Constants captured into the worklet closure. Top-level imports are
  // inlined cleanly by react-native-worklets, but for clarity we pull the
  // numbers we use into named locals here.
  const BAND_LOW_OFFSET = SCAN_HYSTERESIS.HIGH - SCAN_HYSTERESIS.LOW; // 0.12
  const COOLDOWN_MS = SCAN_COOLDOWN_MS;
  const COOLDOWN_FRACTION = SCAN_COOLDOWN_CENTROID_FRACTION;

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    onFrame: (frame: Frame) => {
      'worklet';
      // Hoisted out of the try block so the outer finally can read them
      // even after early returns. `gray` is the Y-plane Mat the trigger
      // branch warps for capture; `opencvDirty` guards `clearBuffers()` so
      // we don't no-op-call it when bufferToMat never ran.
      let gray: any = null;
      let opencvDirty = false;

      try {
        const tune = tunables.getDirty();
        if (!tune.enabled) {
          quad.setBlocking(null);
          metrics.setBlocking({
            ...INITIAL_METRICS,
            frameSize: { width: frame.width, height: frame.height },
            pixelFormat: frame.pixelFormat,
            orientation: frame.orientation,
            isMirrored: frame.isMirrored,
            bytesPerRow: frame.bytesPerRow,
            planesCount: frame.isPlanar ? frame.getPlanes().length : 0,
            framesProcessed: framesProcessedShared.getDirty(),
            lastStep: 'detection-disabled',
          });
          stableFrames.setBlocking(0);
          inBand.setBlocking(false);
          smoothedDetQuad.setBlocking(null);
          smoothMissCount.setBlocking(0);
          history.setBlocking([]);
          return;
        }

        const now = Date.now();
        const lastAt = lastFrameAt.getDirty();
        const dtMs = lastAt === 0 ? 0 : now - lastAt;
        lastFrameAt.setBlocking(now);
        const instantFps = dtMs > 0 ? 1000 / dtMs : 0;
        const prevEma = ema.getDirty();
        const newEma = prevEma === 0 ? instantFps : prevEma * 0.85 + instantFps * 0.15;
        ema.setBlocking(newEma);

        const frameW = frame.width;
        const frameH = frame.height;
        const framePixelFormat = frame.pixelFormat;
        const frameOrientation = frame.orientation;
        const frameIsMirrored = frame.isMirrored;
        const frameBytesPerRow = frame.bytesPerRow;
        const framePlanesCount = frame.isPlanar ? frame.getPlanes().length : 0;

        let yWidth = 0;
        let yHeight = 0;
        let detWPlane = 0;
        let detHPlane = 0;
        let scalePlane = 1;
        let roiX = 0;
        let roiY = 0;

        let detectedQuad: Quad | null = null;
        let bestArea = 0;
        let contourCountForMetrics = 0;
        let candidateQuadCount = 0;
        let edgePixelCount = 0;
        let largeContourCount = 0;
        let bestApproxVertexCount = 0;
        let bestApproxAspect = 0;
        let bestSeenArea = 0;
        let lastStep = 'enter';
        let lastBufferBytes = 0;
        // Per-frame quality metrics computed during the OpenCV pass; defaulted
        // to 0 / out-of-band so the no-detection path still emits sensible
        // metric values for the JS-side debug overlay.
        let sharpnessRaw = 0;
        let brightnessRaw = 0;
        const framesProcessedNow = framesProcessedShared.getDirty() + 1;
        framesProcessedShared.setBlocking(framesProcessedNow);

        let pipelineError = '';
        try {
          if (!frame.isPlanar) {
            lastStep = 'skip:not-planar';
            return;
          }
          const planes = frame.getPlanes();
          if (planes.length === 0) {
            lastStep = 'skip:no-planes';
            return;
          }
          const yPlane = planes[0];
          yWidth = yPlane.width;
          yHeight = yPlane.height;
          const yBytesPerRow = yPlane.bytesPerRow;

          lastStep = 'getPixelBuffer';
          const buffer = yPlane.getPixelBuffer();
          lastBufferBytes = buffer.byteLength;

          const expectedPadded = yBytesPerRow * yHeight;
          if (buffer.byteLength < expectedPadded) {
            lastStep = `skip:short-buffer(got=${buffer.byteLength},need=${expectedPadded})`;
            return;
          }

          lastStep = 'Uint8Array';
          const data = new Uint8Array(buffer);

          lastStep = 'bufferToMat';
          opencvDirty = true;
          if (yBytesPerRow === yWidth) {
            gray = OpenCV.bufferToMat('uint8', yHeight, yWidth, 1, data);
          } else {
            const tight = new Uint8Array(yWidth * yHeight);
            for (let row = 0; row < yHeight; row += 1) {
              const src = row * yBytesPerRow;
              const dst = row * yWidth;
              for (let col = 0; col < yWidth; col += 1) {
                tight[dst + col] = data[src + col];
              }
            }
            gray = OpenCV.bufferToMat('uint8', yHeight, yWidth, 1, tight);
          }

          // Centre-crop to the guide ROI. Buffer is sensor-landscape; portrait
          // card → ROI long axis = buffer X. ROI aspect = MTG_LONG/MTG_SHORT.
          const guideShortFraction = GUIDE_SHORT_FRACTION;
          const guideLongAspect = MTG_LONG / MTG_SHORT; // 1.4
          let roiH = Math.round(yHeight * guideShortFraction);
          let roiW = Math.round(roiH * guideLongAspect);
          if (roiW > yWidth * 0.95) {
            roiW = Math.round(yWidth * 0.95);
            roiH = Math.round(roiW / guideLongAspect);
          }
          roiX = Math.round((yWidth - roiW) / 2);
          roiY = Math.round((yHeight - roiH) / 2);

          lastStep = 'cropROI';
          const grayRoi = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
          const roiRect = OpenCV.createObject(ObjectType.Rect, roiX, roiY, roiW, roiH);
          OpenCV.invoke('crop', gray, grayRoi, roiRect);

          detWPlane = Math.min(DETECT_WIDTH, roiW);
          detHPlane = Math.round((detWPlane * roiH) / roiW);
          scalePlane = roiW / detWPlane;

          lastStep = 'createSmall';
          const small = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
          const sizeSmall = OpenCV.createObject(ObjectType.Size, detWPlane, detHPlane);
          lastStep = 'resize';
          OpenCV.invoke('resize', grayRoi, small, sizeSmall, 0, 0, InterpolationFlags.INTER_AREA);

          // --- Quality signals computed on the small Mat (cheap; ~1 ms total).
          // Brightness: mean luminance of the ROI. Used both as a hard floor
          // (the captured frame must be inside [30, 235]) and a soft penalty.
          lastStep = 'mean.brightness';
          const brightnessScalar = OpenCV.invoke('mean', small);
          const brightnessJs = OpenCV.toJSValue(brightnessScalar);
          brightnessRaw = brightnessJs.a;

          // Sharpness: mean of |Laplacian| on the small Mat. Higher = sharper.
          // Using mean(|L|) instead of var(L) avoids needing a separate
          // squaring step; in-focus card scans cluster ~30-60, blur < 10.
          lastStep = 'Laplacian';
          const lapl = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_16SC1);
          OpenCV.invoke('Laplacian', small, lapl, DataTypes.CV_16S, 3, 1, 0, BorderTypes.BORDER_DEFAULT);
          lastStep = 'convertScaleAbs';
          const laplAbs = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
          OpenCV.invoke('convertScaleAbs', lapl, laplAbs, 1);
          lastStep = 'mean.sharpness';
          const sharpnessScalar = OpenCV.invoke('mean', laplAbs);
          const sharpnessJs = OpenCV.toJSValue(sharpnessScalar);
          sharpnessRaw = sharpnessJs.a;

          lastStep = 'GaussianBlur';
          const blurred = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
          const blurKsize = OpenCV.createObject(ObjectType.Size, 5, 5);
          OpenCV.invoke('GaussianBlur', small, blurred, blurKsize, 0);

          lastStep = 'Canny';
          const edges = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
          OpenCV.invoke('Canny', blurred, edges, 30, 100);

          lastStep = 'morphClose';
          const morphKernel = OpenCV.invoke(
            'getStructuringElement',
            MorphShapes.MORPH_RECT,
            OpenCV.createObject(ObjectType.Size, 5, 5),
          );
          const closed = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
          OpenCV.invoke('morphologyEx', edges, closed, MorphTypes.MORPH_CLOSE, morphKernel);

          lastStep = 'countNonZero';
          edgePixelCount = OpenCV.invoke('countNonZero', closed).value;

          lastStep = 'findContours';
          const contours = OpenCV.createObject(ObjectType.MatVector);
          OpenCV.invoke(
            'findContours',
            closed,
            contours,
            RetrievalModes.RETR_EXTERNAL,
            ContourApproximationModes.CHAIN_APPROX_SIMPLE,
          );

          lastStep = 'toJSValue.contours';
          const contourCount = OpenCV.toJSValue(contours).array.length;
          contourCountForMetrics = contourCount;
          const minArea = detWPlane * detHPlane * MIN_AREA_FRACTION;

          for (let i = 0; i < contourCount; i += 1) {
            const contour = OpenCV.copyObjectFromVector(contours, i);
            const area = OpenCV.invoke('contourArea', contour, false).value;
            if (area < minArea) continue;
            largeContourCount += 1;

            const rrect = OpenCV.invoke('minAreaRect', contour);
            const rrectJs = OpenCV.toJSValue(rrect);
            const rectArea = rrectJs.width * rrectJs.height;
            if (rectArea <= 0) continue;
            const fillRatio = area / rectArea;
            const aspect =
              Math.min(rrectJs.width, rrectJs.height) /
              Math.max(rrectJs.width, rrectJs.height);

            if (area > bestSeenArea) {
              bestSeenArea = area;
              bestApproxVertexCount = Math.round(fillRatio * 100);
              bestApproxAspect = aspect;
            }

            if (fillRatio < FILL_RATIO_MIN) continue;
            if (Math.abs(aspect - MTG_ASPECT) > ASPECT_TOLERANCE) continue;

            const angleRad = (rrectJs.angle * Math.PI) / 180;
            const cosA = Math.cos(angleRad);
            const sinA = Math.sin(angleRad);
            const halfW = rrectJs.width / 2;
            const halfH = rrectJs.height / 2;
            const cx = rrectJs.centerX;
            const cy = rrectJs.centerY;
            const corners: Quad = [
              { x: cx + (-halfW) * cosA - (-halfH) * sinA, y: cy + (-halfW) * sinA + (-halfH) * cosA },
              { x: cx + halfW * cosA - (-halfH) * sinA, y: cy + halfW * sinA + (-halfH) * cosA },
              { x: cx + halfW * cosA - halfH * sinA, y: cy + halfW * sinA + halfH * cosA },
              { x: cx + (-halfW) * cosA - halfH * sinA, y: cy + (-halfW) * sinA + halfH * cosA },
            ];
            const ordered = orderQuadCorners(corners);

            candidateQuadCount += 1;
            if (area > bestArea) {
              bestArea = area;
              detectedQuad = ordered;
            }
          }

          lastStep = 'done';
        } catch (e: unknown) {
          const raw = e instanceof Error ? e.message : String(e);
          pipelineError = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
          quad.setBlocking(null);
          metrics.setBlocking({
            ...INITIAL_METRICS,
            frameSize: { width: frameW, height: frameH },
            detectionFps: newEma,
            pixelFormat: framePixelFormat,
            orientation: frameOrientation,
            isMirrored: frameIsMirrored,
            bytesPerRow: frameBytesPerRow,
            planesCount: framePlanesCount,
            framesProcessed: framesProcessedNow,
            lastBufferBytes,
            lastError: pipelineError,
            lastStep,
            edgePixelCount,
            contourCount: contourCountForMetrics,
            largeContourCount,
            bestApproxVertexCount,
            bestApproxAspect,
          });
          stableFrames.setBlocking(0);
          inBand.setBlocking(false);
          return;
        }

        // Smooth the detection-space quad with a per-corner EMA. On a missed
        // detection, hold the previous smoothed quad alive briefly so 1–2
        // frame jitter doesn't reset the stable-frame counter.
        let activeQuad: Quad | null = detectedQuad;
        if (detectedQuad) {
          const prevSmoothed = smoothedDetQuad.getDirty();
          if (prevSmoothed) {
            const a = QUAD_SMOOTH_ALPHA;
            const inv = 1 - a;
            activeQuad = [
              { x: prevSmoothed[0].x * inv + detectedQuad[0].x * a, y: prevSmoothed[0].y * inv + detectedQuad[0].y * a },
              { x: prevSmoothed[1].x * inv + detectedQuad[1].x * a, y: prevSmoothed[1].y * inv + detectedQuad[1].y * a },
              { x: prevSmoothed[2].x * inv + detectedQuad[2].x * a, y: prevSmoothed[2].y * inv + detectedQuad[2].y * a },
              { x: prevSmoothed[3].x * inv + detectedQuad[3].x * a, y: prevSmoothed[3].y * inv + detectedQuad[3].y * a },
            ];
          }
          smoothedDetQuad.setBlocking(activeQuad);
          smoothMissCount.setBlocking(0);
        } else {
          const misses = smoothMissCount.getDirty() + 1;
          smoothMissCount.setBlocking(misses);
          if (misses <= QUAD_SMOOTH_GRACE_FRAMES) {
            activeQuad = smoothedDetQuad.getDirty();
          } else {
            smoothedDetQuad.setBlocking(null);
          }
        }

        if (!activeQuad) {
          quad.setBlocking(null);
          history.setBlocking([]);
          stableFrames.setBlocking(0);
          inBand.setBlocking(false);
          // Even with no quad, surface remaining cooldown so the JS pill can
          // show "Cooldown 0.8 s" while the user is between cards.
          const cdNoQuad = lastCapture.getDirty();
          const cooldownRemainingMsNoQuad =
            cdNoQuad && now - cdNoQuad.at < COOLDOWN_MS
              ? COOLDOWN_MS - (now - cdNoQuad.at)
              : 0;
          metrics.setBlocking({
            score: 0,
            stability: 0,
            sharpness: 0,
            coverage: 0,
            brightnessFit: 0,
            brightness: brightnessRaw,
            detectionFps: newEma,
            frameSize: { width: frameW, height: frameH },
            hasQuad: false,
            hardFloorPass: false,
            inHysteresis: false,
            cooldownActive: false,
            cooldownRemainingMs: cooldownRemainingMsNoQuad,
            pixelFormat: framePixelFormat,
            orientation: frameOrientation,
            isMirrored: frameIsMirrored,
            bytesPerRow: frameBytesPerRow,
            planesCount: framePlanesCount,
            contourCount: contourCountForMetrics,
            candidateQuadCount,
            historyDepth: 0,
            edgePixelCount,
            framesProcessed: framesProcessedNow,
            lastBufferBytes,
            lastError: pipelineError,
            lastStep,
            largeContourCount,
            bestApproxVertexCount,
            bestApproxAspect,
          });
          return;
        }

        // Append to short history for stability scoring.
        const prevHist = history.getDirty().slice();
        prevHist.push(activeQuad);
        if (prevHist.length > STABILITY_HISTORY) prevHist.shift();
        history.setBlocking(prevHist);

        // ----- Decision-policy signals (all in [0..1] unless noted). -----
        // Stability normalised to the quad's short edge: a big card needs the
        // same *relative* steadiness as a small one.
        const shortEdgeDet = quadShortEdge(activeQuad);
        const stabilityCeiling = Math.max(STABILITY_CEILING_MIN, shortEdgeDet * STABILITY_CEILING_FRACTION);
        const stability = stabilityScoreNormalised(activeQuad, prevHist, stabilityCeiling);

        const coverage = coverageScore(activeQuad, detWPlane, detHPlane);

        // Sharpness: normalise mean-abs-Laplacian to 0..1.
        const sharpness =
          sharpnessRaw <= 0 ? 0 : Math.min(1, sharpnessRaw / SHARPNESS_NORM_DIVISOR);

        // Brightness fit: 1.0 inside [80, 200], linear ramp to 0 toward the
        // hard-floor edges. Also feeds the brightness hard floor below.
        const brightnessFit = brightnessFitScore(brightnessRaw);

        // Composite soft score, weights configurable.
        const composite =
          tune.wStability * stability +
          tune.wSharpness * sharpness +
          tune.wCoverage * coverage +
          tune.wBrightness * brightnessFit;

        // Hard-floor pass: every signal must clear its individual minimum.
        const hardFloorPass =
          coverage >= HARD_FLOOR_COVERAGE &&
          stability >= HARD_FLOOR_STABILITY &&
          sharpness >= HARD_FLOOR_SHARPNESS &&
          brightnessRaw >= HARD_FLOOR_BRIGHTNESS_MIN &&
          brightnessRaw <= HARD_FLOOR_BRIGHTNESS_MAX;

        // Hysteresis band update.
        const thresholdHigh = tune.thresholdHigh;
        const thresholdLow = thresholdHigh - BAND_LOW_OFFSET;
        const wasInBand = inBand.getDirty();
        let nowInBand = wasInBand;
        if (!wasInBand && composite >= thresholdHigh) {
          nowInBand = true;
        } else if (wasInBand && composite < thresholdLow) {
          nowInBand = false;
        }
        inBand.setBlocking(nowInBand);

        // Content-cooldown evaluation.
        const cooldown = lastCapture.getDirty();
        let cooldownActive = false;
        let cooldownRemainingMs = 0;
        if (cooldown && now - cooldown.at < COOLDOWN_MS) {
          cooldownRemainingMs = COOLDOWN_MS - (now - cooldown.at);
          const cx = (activeQuad[0].x + activeQuad[2].x) / 2;
          const cy = (activeQuad[0].y + activeQuad[2].y) / 2;
          const dx = cx - cooldown.centroidX;
          const dy = cy - cooldown.centroidY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < cooldown.shortEdge * COOLDOWN_FRACTION) {
            cooldownActive = true;
          }
        }

        // Project detection-space coords back into frame-space.
        const sx = frameW / yWidth;
        const sy = frameH / yHeight;
        const frameQuad: Quad = [
          { x: (activeQuad[0].x * scalePlane + roiX) * sx, y: (activeQuad[0].y * scalePlane + roiY) * sy },
          { x: (activeQuad[1].x * scalePlane + roiX) * sx, y: (activeQuad[1].y * scalePlane + roiY) * sy },
          { x: (activeQuad[2].x * scalePlane + roiX) * sx, y: (activeQuad[2].y * scalePlane + roiY) * sy },
          { x: (activeQuad[3].x * scalePlane + roiX) * sx, y: (activeQuad[3].y * scalePlane + roiY) * sy },
        ];

        quad.setBlocking(frameQuad);
        metrics.setBlocking({
          score: composite,
          stability,
          sharpness,
          coverage,
          brightnessFit,
          brightness: brightnessRaw,
          detectionFps: newEma,
          frameSize: { width: frameW, height: frameH },
          hasQuad: true,
          hardFloorPass,
          inHysteresis: nowInBand,
          cooldownActive,
          cooldownRemainingMs,
          pixelFormat: framePixelFormat,
          orientation: frameOrientation,
          isMirrored: frameIsMirrored,
          bytesPerRow: frameBytesPerRow,
          planesCount: framePlanesCount,
          contourCount: contourCountForMetrics,
          candidateQuadCount,
          historyDepth: prevHist.length,
          edgePixelCount,
          framesProcessed: framesProcessedNow,
          lastBufferBytes,
          lastError: pipelineError,
          lastStep,
          largeContourCount,
          bestApproxVertexCount,
          bestApproxAspect,
        });

        // Trigger logic. All gates must pass to increment the stable counter:
        // (1) hard floors, (2) inside the hysteresis band, (3) not in a
        // content cooldown. Any single gate failure resets the counter.
        if (!hardFloorPass || !nowInBand || cooldownActive) {
          stableFrames.setBlocking(0);
          return;
        }

        const nextStable = stableFrames.getDirty() + 1;
        stableFrames.setBlocking(nextStable);
        if (tune.autoCaptureEnabled && nextStable >= tune.minStableFrames) {
          // Record the cooldown anchor BEFORE handing off to JS, in
          // detection-space coords (matches `activeQuad`).
          const captureCx = (activeQuad[0].x + activeQuad[2].x) / 2;
          const captureCy = (activeQuad[0].y + activeQuad[2].y) / 2;
          lastCapture.setBlocking({
            at: now,
            centroidX: captureCx,
            centroidY: captureCy,
            shortEdge: shortEdgeDet,
          });

          // The Y-plane gray Mat is still alive (clearBuffers runs in the
          // outer finally below). Warp the detected quad straight to the
          // canonical MTG_OUTPUT rect and JPEG-encode it to a cache file.
          // The URI is what goes to JS — no second photoOutput round-trip,
          // no temporal gap, what the worklet approved IS what gets uploaded.
          let captureUri = '';
          try {
            // Map activeQuad (detection-space) → buffer-space (gray Mat coords).
            const bp0x = activeQuad[0].x * scalePlane + roiX;
            const bp0y = activeQuad[0].y * scalePlane + roiY;
            const bp1x = activeQuad[1].x * scalePlane + roiX;
            const bp1y = activeQuad[1].y * scalePlane + roiY;
            const bp2x = activeQuad[2].x * scalePlane + roiX;
            const bp2y = activeQuad[2].y * scalePlane + roiY;
            const bp3x = activeQuad[3].x * scalePlane + roiX;
            const bp3y = activeQuad[3].y * scalePlane + roiY;

            const srcPt0 = OpenCV.createObject(ObjectType.Point2f, bp0x, bp0y);
            const srcPt1 = OpenCV.createObject(ObjectType.Point2f, bp1x, bp1y);
            const srcPt2 = OpenCV.createObject(ObjectType.Point2f, bp2x, bp2y);
            const srcPt3 = OpenCV.createObject(ObjectType.Point2f, bp3x, bp3y);
            const srcPts = OpenCV.createObject(ObjectType.Point2fVector, [srcPt0, srcPt1, srcPt2, srcPt3]);

            const W = MTG_OUTPUT_WIDTH;
            const H = MTG_OUTPUT_HEIGHT;
            const dstPt0 = OpenCV.createObject(ObjectType.Point2f, 0, 0);
            const dstPt1 = OpenCV.createObject(ObjectType.Point2f, W - 1, 0);
            const dstPt2 = OpenCV.createObject(ObjectType.Point2f, W - 1, H - 1);
            const dstPt3 = OpenCV.createObject(ObjectType.Point2f, 0, H - 1);
            const dstPts = OpenCV.createObject(ObjectType.Point2fVector, [dstPt0, dstPt1, dstPt2, dstPt3]);

            const transform = OpenCV.invoke('getPerspectiveTransform', srcPts, dstPts, DecompTypes.DECOMP_LU);
            const warped = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
            const outSize = OpenCV.createObject(ObjectType.Size, W, H);
            const borderValue = OpenCV.createObject(ObjectType.Scalar, 0, 0, 0);
            OpenCV.invoke(
              'warpPerspective',
              gray,
              warped,
              transform,
              outSize,
              InterpolationFlags.INTER_CUBIC,
              BorderTypes.BORDER_CONSTANT,
              borderValue,
            );

            const fileName = `lupira-scan-${now}.jpg`;
            const cacheUri = `${CACHE_DIR_PREFIX}/${fileName}`;
            const diskPath = cacheUri.replace(/^file:\/\//, '');
            OpenCV.saveMatToFile(warped, diskPath, 'jpeg', MTG_OUTPUT_JPEG_QUALITY);
            captureUri = cacheUri;
          } catch (e: unknown) {
            // Warp/save failed — fall through with empty URI. JS treats
            // empty URI as a silent miss and the worklet keeps running on
            // the next stable-frame attempt.
            const raw = e instanceof Error ? e.message : String(e);
            pipelineError = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
            lastStep = 'warpAndSave:failed';
          }

          stableFrames.setBlocking(0);
          inBand.setBlocking(false);
          tunables.setBlocking({ ...tune, enabled: false });
          runOnJS(triggerAutoCapture)(captureUri, frameQuad, { width: frameW, height: frameH });
        }
      } finally {
        // Single cleanup site. `clearBuffers` now runs *after* the trigger
        // branch's warp-and-save so `gray` is alive when the warp needs it,
        // and *before* the frame is disposed so we never leak OpenCV objects.
        if (opencvDirty) {
          OpenCV.clearBuffers();
        }
        frame.dispose();
      }
    },
  });

  const resume = () => {
    const cur = tunables.getDirty();
    if (!cur.enabled) {
      tunables.setBlocking({ ...cur, enabled: true });
      stableFrames.setBlocking(0);
      inBand.setBlocking(false);
      smoothedDetQuad.setBlocking(null);
      smoothMissCount.setBlocking(0);
      history.setBlocking([]);
    }
  };

  const pause = () => {
    const cur = tunables.getDirty();
    if (cur.enabled) {
      tunables.setBlocking({ ...cur, enabled: false });
    }
  };

  return { quad, metrics, stableFrames, frameOutput, resume, pause };
}

// --- Pure helpers (worklet-safe). Each is fully self-contained; cross-helper
// calls are forbidden because react-native-worklets does not reliably capture
// sibling helpers into the worklet runtime closure.

function orderQuadCorners(q: Quad): Quad {
  'worklet';
  // Find image-aligned TL/TR/BR/BL by sums and diffs of (x, y).
  let tlIdx = 0;
  if (q[1].x + q[1].y < q[tlIdx].x + q[tlIdx].y) tlIdx = 1;
  if (q[2].x + q[2].y < q[tlIdx].x + q[tlIdx].y) tlIdx = 2;
  if (q[3].x + q[3].y < q[tlIdx].x + q[tlIdx].y) tlIdx = 3;
  let brIdx = 0;
  if (q[1].x + q[1].y > q[brIdx].x + q[brIdx].y) brIdx = 1;
  if (q[2].x + q[2].y > q[brIdx].x + q[brIdx].y) brIdx = 2;
  if (q[3].x + q[3].y > q[brIdx].x + q[brIdx].y) brIdx = 3;
  let trIdx = 0;
  if (q[1].y - q[1].x < q[trIdx].y - q[trIdx].x) trIdx = 1;
  if (q[2].y - q[2].x < q[trIdx].y - q[trIdx].x) trIdx = 2;
  if (q[3].y - q[3].x < q[trIdx].y - q[trIdx].x) trIdx = 3;
  let blIdx = 0;
  if (q[1].y - q[1].x > q[blIdx].y - q[blIdx].x) blIdx = 1;
  if (q[2].y - q[2].x > q[blIdx].y - q[blIdx].x) blIdx = 2;
  if (q[3].y - q[3].x > q[blIdx].y - q[blIdx].x) blIdx = 3;
  const tl = q[tlIdx];
  const tr = q[trIdx];
  const br = q[brIdx];
  const bl = q[blIdx];

  // Portrait card in landscape sensor frame: image-aligned width > height
  // means the card's long axis lies along the image x-axis. Rotate the
  // corner array 90° CCW so the perspective transform downstream maps the
  // card's true top edge to the output's top edge.
  let dx = tl.x - tr.x; let dy = tl.y - tr.y;
  const widthA = Math.sqrt(dx * dx + dy * dy);
  dx = tl.x - bl.x; dy = tl.y - bl.y;
  const heightA = Math.sqrt(dx * dx + dy * dy);
  if (widthA > heightA) {
    return [bl, tl, tr, br];
  }
  return [tl, tr, br, bl];
}

/** Average of the four side lengths' shorter pair (≈ short edge of the quad). */
function quadShortEdge(q: Quad): number {
  'worklet';
  let dx = q[0].x - q[1].x, dy = q[0].y - q[1].y;
  const top = Math.sqrt(dx * dx + dy * dy);
  dx = q[3].x - q[2].x; dy = q[3].y - q[2].y;
  const bottom = Math.sqrt(dx * dx + dy * dy);
  dx = q[0].x - q[3].x; dy = q[0].y - q[3].y;
  const left = Math.sqrt(dx * dx + dy * dy);
  dx = q[1].x - q[2].x; dy = q[1].y - q[2].y;
  const right = Math.sqrt(dx * dx + dy * dy);
  const w = (top + bottom) / 2;
  const h = (left + right) / 2;
  return Math.min(w, h);
}

/**
 * Stability score in [0..1] using a *relative* ceiling.
 * `ceiling` is the average corner displacement at which stability hits 0.
 */
function stabilityScoreNormalised(current: Quad, history: Quad[], ceiling: number): number {
  'worklet';
  if (history.length < 2) return 0;
  let total = 0;
  let samples = 0;
  for (let i = 0; i < history.length - 1; i += 1) {
    const prev = history[i];
    for (let c = 0; c < 4; c += 1) {
      const dx = prev[c].x - current[c].x;
      const dy = prev[c].y - current[c].y;
      total += Math.sqrt(dx * dx + dy * dy);
      samples += 1;
    }
  }
  const avg = samples > 0 ? total / samples : ceiling;
  const ratio = 1 - avg / ceiling;
  if (!Number.isFinite(ratio)) return 0;
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

function coverageScore(quad: Quad, w: number, h: number): number {
  'worklet';
  // Inline shoelace formula on the 4 corners.
  const a = quad[0]; const b = quad[1]; const c = quad[2]; const d = quad[3];
  const area = Math.abs(
    a.x * b.y - b.x * a.y + (b.x * c.y - c.x * b.y) + (c.x * d.y - d.x * c.y) + (d.x * a.y - a.x * d.y),
  ) / 2;
  const fraction = area / (w * h);
  if (fraction <= 0.1) return 0;
  if (fraction >= 0.9) return 0;
  if (fraction < 0.35) return (fraction - 0.1) / 0.25;
  if (fraction > 0.65) return 1 - (fraction - 0.65) / 0.25;
  return 1;
}

/**
 * Brightness fit in [0..1]. Peaks at 1.0 inside [80, 200] and ramps linearly
 * to 0 at the hard-floor edges (30 / 235). Outside the hard-floor band the
 * value is 0 — the brightness hard-floor gate also rejects the frame.
 */
function brightnessFitScore(meanLum: number): number {
  'worklet';
  const HARD_MIN = 30;
  const HARD_MAX = 235;
  const SOFT_MIN = 80;
  const SOFT_MAX = 200;
  if (meanLum <= HARD_MIN || meanLum >= HARD_MAX) return 0;
  if (meanLum >= SOFT_MIN && meanLum <= SOFT_MAX) return 1;
  if (meanLum < SOFT_MIN) {
    return (meanLum - HARD_MIN) / (SOFT_MIN - HARD_MIN);
  }
  // meanLum > SOFT_MAX
  return 1 - (meanLum - SOFT_MAX) / (HARD_MAX - SOFT_MAX);
}

// `APPROX_EPSILON_FRACTIONS` is currently unused by the simplified detector
// (we picked minAreaRect corners instead of approxPolyDP). Kept exported via
// closure so code-search still finds the constant if we re-introduce that
// path later. Unused-references suppressed by the void below.
void APPROX_EPSILON_FRACTIONS;
