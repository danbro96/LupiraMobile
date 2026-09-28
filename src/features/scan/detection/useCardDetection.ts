import { useEffect, useMemo, useRef } from 'react';
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
  SCAN_HYSTERESIS_BAND,
} from '../../../store/scan-settings-store';
import { useSyncedValue } from './useSyncedValue';

/**
 * Output dimensions for the worklet-emitted card crop. The source is the worklet's Y-plane (1280×720
 * typical), so 1200×1680 is mild upsampling — fine, since the backend re-canonicalises to ~750 px anyway.
 */
const MTG_OUTPUT_WIDTH = 1200;
const MTG_OUTPUT_HEIGHT = 1680;
/** JPEG quality used by `saveMatToFile` inside the worklet (0..1 → 0..100). */
const MTG_OUTPUT_JPEG_QUALITY = 0.92;
/** Static string, so it can be captured into the worklet closure. */
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
  /** True while the last captured card is still in view; cleared once it leaves the frame or moves away. */
  cooldownActive: boolean;
  pixelFormat: string;
  orientation: string;
  isMirrored: boolean;
  bytesPerRow: number;
  planesCount: number;
  contourCount: number;
  candidateQuadCount: number;
  /** Card-shaped contours rejected because a corner touches the guide edge (card overflows the guide). */
  clippedQuadCount: number;
  historyDepth: number;
  edgePixelCount: number;
  largeContourCount: number;
  /** Fill ratio of the largest contour as a 0-100 percentage. */
  largestContourFillPct: number;
  largestContourAspect: number;
  framesProcessed: number;
  lastBufferBytes: number;
  lastError: string;
  lastStep: string;
};

/**
 * Worklet-side snapshot taken at the instant auto-capture fired. The shared `metrics` value is overwritten
 * by the next frame, so JS must not read it back for the fire record.
 */
export type CaptureDiagnostics = {
  metrics: DetectionMetrics;
  stableFrames: number;
  sharpnessRaw: number;
  /** Quad corners in Y-plane buffer pixels — the exact source of the warp. */
  bufferQuad: Quad;
  bufferSize: FrameSize;
  roi: { x: number; y: number; width: number; height: number };
  warpMs: number;
  /** Empty unless warp/encode threw; `captureUri` is then empty too. */
  error: string;
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
   * Invoked on the JS thread once the worklet has approved a frame and JPEG-encoded the perspective-corrected
   * crop to a `file://` cache URI. Empty if warp/encode failed; treat that as a silent miss.
   */
  onAutoCapture: (captureUri: string, quad: Quad, frameSize: FrameSize, diag: CaptureDiagnostics) => void;
};

export type CardDetectionState = {
  quad: Synchronizable<Quad | null>;
  metrics: Synchronizable<DetectionMetrics>;
  stableFrames: Synchronizable<number>;
  frameOutput: CameraFrameOutput;
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
  pixelFormat: 'unknown',
  orientation: 'unknown',
  isMirrored: false,
  bytesPerRow: 0,
  planesCount: 0,
  contourCount: 0,
  candidateQuadCount: 0,
  clippedQuadCount: 0,
  historyDepth: 0,
  edgePixelCount: 0,
  largeContourCount: 0,
  largestContourFillPct: 0,
  largestContourAspect: 0,
  framesProcessed: 0,
  lastBufferBytes: 0,
  lastError: '',
  lastStep: '',
};

/** Portrait short/long ratio of an MTG card. */
export const MTG_ASPECT = 2.5 / 3.5;
const MTG_SHORT = 2.5;
const MTG_LONG = 3.5;
const ASPECT_TOLERANCE = 0.3;
const MIN_AREA_FRACTION = 0.05;
const FILL_RATIO_MIN = 0.7;
/**
 * Detection-space px. Canny finds no gradient on the ROI border, so a card overflowing the guide yields a
 * contour clipped to the border — its warp would cut off the card's edge.
 */
const ROI_EDGE_MARGIN = 3;
/**
 * Fraction of the buffer's *short* axis that the centred detection-ROI takes.
 * The companion display-side GuideFrame uses the same value so the on-screen
 * guide rectangle aligns with where the worklet actually looks.
 */
export const GUIDE_SHORT_FRACTION = 0.55;
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
/**
 * Consecutive frames (~0.3 s at 30 fps) with no card-shaped contour at all — neither detected nor clipped by the
 * guide edge — that count as the captured card having left the frame. A card slipping past the guide edge is still
 * in view and must not re-arm capture.
 */
const CARD_REMOVED_MISS_FRAMES = 10;

// --- Decision-policy hard floors. Each signal must clear its floor every
// frame; a single failure resets the stable counter regardless of composite.
// Exported so the JS-thread debug log can derive *which* floor blocked
// without duplicating the constants.
export const HARD_FLOORS = {
  coverage: 0.2,
  stability: 0.55,
  sharpness: 0.65,
  /** Raw luminance band (0..255) the captured frame must sit inside. */
  brightnessMin: 30,
  brightnessMax: 235,
} as const;

/**
 * Sharpness normalisation divisor for the mean-absolute-Laplacian metric (YUV-Y small Mat, 3×3 kernel). On
 * device, sharp sleeved-card captures measured 53–63 raw and a motion-blurred one 31 — which still OCRs to
 * mush. Dividing by 60 keeps them apart; with the 0.65 hard floor the gate sits at raw ≈ 39.
 */
const SHARPNESS_NORM_DIVISOR = 60;
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
  const cardAbsentFrames = useSyncedValue<number>(0);
  // The most recently captured card, in detection space (matches `activeQuad`). Blocks re-fires until
  // that card leaves the frame or moves away — a timer let a held card re-fire every ~1.6 s, and each
  // capture costs a 5–20 s OCR call.
  const lastCapture = useSyncedValue<{
    centroidX: number;
    centroidY: number;
    shortEdge: number;
  } | null>(null);

  const tuning = useMemo(
    () => ({
      enabled: params.enabled,
      autoCaptureEnabled: params.autoCaptureEnabled,
      /** Upper edge of the hysteresis band; the lower edge is this minus `SCAN_HYSTERESIS_BAND`. */
      thresholdHigh: params.threshold,
      minStableFrames: params.minStableFrames,
      wStability: params.weightStability,
      wSharpness: params.weightSharpness,
      wCoverage: params.weightCoverage,
      wBrightness: params.weightBrightness,
    }),
    [
      params.enabled,
      params.autoCaptureEnabled,
      params.threshold,
      params.minStableFrames,
      params.weightStability,
      params.weightSharpness,
      params.weightCoverage,
      params.weightBrightness,
    ],
  );
  const tunables = useSyncedValue(tuning);
  useEffect(() => {
    tunables.setBlocking(tuning);
  }, [tunables, tuning]);

  const onAutoCaptureRef = useRef(params.onAutoCapture);
  onAutoCaptureRef.current = params.onAutoCapture;

  const triggerAutoCapture = (captureUri: string, q: Quad, size: FrameSize, diag: CaptureDiagnostics) => {
    onAutoCaptureRef.current(captureUri, q, size, diag);
  };

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    onFrame: (frame: Frame) => {
      'worklet';
      // Hoisted so the outer finally sees them after early returns; `gray` must outlive the capture warp.
      let gray: any = null;
      let opencvDirty = false;

      const resetTracking = () => {
        stableFrames.setBlocking(0);
        inBand.setBlocking(false);
        smoothedDetQuad.setBlocking(null);
        smoothMissCount.setBlocking(0);
        history.setBlocking([]);
      };

      try {
        const tune = tunables.getDirty();
        const planes = frame.isPlanar ? frame.getPlanes() : [];
        if (!tune.enabled) {
          quad.setBlocking(null);
          metrics.setBlocking({
            ...INITIAL_METRICS,
            frameSize: { width: frame.width, height: frame.height },
            pixelFormat: frame.pixelFormat,
            orientation: frame.orientation,
            isMirrored: frame.isMirrored,
            bytesPerRow: frame.bytesPerRow,
            planesCount: planes.length,
            framesProcessed: framesProcessedShared.getDirty(),
            lastStep: 'detection-disabled',
          });
          resetTracking();
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

        let yWidth = 0;
        let yHeight = 0;
        let detWPlane = 0;
        let detHPlane = 0;
        let scalePlane = 1;
        let roiX = 0;
        let roiY = 0;
        let roiWidth = 0;
        let roiHeight = 0;

        let detectedQuad: Quad | null = null;
        let bestArea = 0;
        let contourCountForMetrics = 0;
        let candidateQuadCount = 0;
        let clippedQuadCount = 0;
        let edgePixelCount = 0;
        let largeContourCount = 0;
        let largestContourFillPct = 0;
        let largestContourAspect = 0;
        let bestSeenArea = 0;
        let lastStep = 'enter';
        let lastBufferBytes = 0;
        let sharpnessRaw = 0;
        let brightnessRaw = 0;
        const framesProcessedNow = framesProcessedShared.getDirty() + 1;
        framesProcessedShared.setBlocking(framesProcessedNow);

        let pipelineError = '';
        const pipelineMetrics = (): DetectionMetrics => ({
          ...INITIAL_METRICS,
          frameSize: { width: frameW, height: frameH },
          detectionFps: newEma,
          pixelFormat: frame.pixelFormat,
          orientation: frame.orientation,
          isMirrored: frame.isMirrored,
          bytesPerRow: frame.bytesPerRow,
          planesCount: planes.length,
          contourCount: contourCountForMetrics,
          candidateQuadCount,
          clippedQuadCount,
          edgePixelCount,
          largeContourCount,
          largestContourFillPct,
          largestContourAspect,
          framesProcessed: framesProcessedNow,
          lastBufferBytes,
          lastError: pipelineError,
          lastStep,
        });

        try {
          if (!frame.isPlanar) {
            lastStep = 'skip:not-planar';
            return;
          }
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
          roiWidth = roiW;
          roiHeight = roiH;

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

          lastStep = 'mean.brightness';
          const brightnessScalar = OpenCV.invoke('mean', small);
          const brightnessJs = OpenCV.toJSValue(brightnessScalar);
          brightnessRaw = brightnessJs.a;

          // mean(|Laplacian|) rather than var(L): no separate squaring step.
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
              largestContourFillPct = Math.round(fillRatio * 100);
              largestContourAspect = aspect;
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
            let clipped = false;
            for (let k = 0; k < 4; k += 1) {
              const p = corners[k];
              if (
                p.x < ROI_EDGE_MARGIN ||
                p.y < ROI_EDGE_MARGIN ||
                p.x > detWPlane - 1 - ROI_EDGE_MARGIN ||
                p.y > detHPlane - 1 - ROI_EDGE_MARGIN
              ) {
                clipped = true;
              }
            }
            if (clipped) {
              clippedQuadCount += 1;
              continue;
            }
            const ordered = orderQuadCorners(corners);

            candidateQuadCount += 1;
            if (area > bestArea) {
              bestArea = area;
              detectedQuad = ordered;
            }
          }

          lastStep = 'done';
        } catch (e: unknown) {
          pipelineError = truncatedErrorMessage(e);
          quad.setBlocking(null);
          metrics.setBlocking(pipelineMetrics());
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

        const absent = detectedQuad || clippedQuadCount > 0 ? 0 : cardAbsentFrames.getDirty() + 1;
        cardAbsentFrames.setBlocking(absent);
        if (absent >= CARD_REMOVED_MISS_FRAMES) {
          lastCapture.setBlocking(null);
        }

        if (!activeQuad) {
          quad.setBlocking(null);
          history.setBlocking([]);
          stableFrames.setBlocking(0);
          inBand.setBlocking(false);
          metrics.setBlocking({
            ...pipelineMetrics(),
            brightness: brightnessRaw,
          });
          return;
        }

        const prevHist = history.getDirty().slice();
        prevHist.push(activeQuad);
        if (prevHist.length > STABILITY_HISTORY) prevHist.shift();
        history.setBlocking(prevHist);

        const shortEdgeDet = quadShortEdge(activeQuad);
        const stabilityCeiling = Math.max(STABILITY_CEILING_MIN, shortEdgeDet * STABILITY_CEILING_FRACTION);
        const stability = stabilityScoreNormalised(activeQuad, prevHist, stabilityCeiling);

        const coverage = coverageScore(activeQuad, detWPlane, detHPlane);

        const sharpness =
          sharpnessRaw <= 0 ? 0 : Math.min(1, sharpnessRaw / SHARPNESS_NORM_DIVISOR);

        const brightnessFit = brightnessFitScore(brightnessRaw);

        const composite =
          tune.wStability * stability +
          tune.wSharpness * sharpness +
          tune.wCoverage * coverage +
          tune.wBrightness * brightnessFit;

        const hardFloorPass =
          coverage >= HARD_FLOORS.coverage &&
          stability >= HARD_FLOORS.stability &&
          sharpness >= HARD_FLOORS.sharpness &&
          brightnessRaw >= HARD_FLOORS.brightnessMin &&
          brightnessRaw <= HARD_FLOORS.brightnessMax;

        const thresholdHigh = tune.thresholdHigh;
        const thresholdLow = thresholdHigh - SCAN_HYSTERESIS_BAND;
        const wasInBand = inBand.getDirty();
        let nowInBand = wasInBand;
        if (!wasInBand && composite >= thresholdHigh) {
          nowInBand = true;
        } else if (wasInBand && composite < thresholdLow) {
          nowInBand = false;
        }
        inBand.setBlocking(nowInBand);

        const centroidX = (activeQuad[0].x + activeQuad[2].x) / 2;
        const centroidY = (activeQuad[0].y + activeQuad[2].y) / 2;
        const cooldown = lastCapture.getDirty();
        let cooldownActive = false;
        if (cooldown) {
          const dx = centroidX - cooldown.centroidX;
          const dy = centroidY - cooldown.centroidY;
          if (Math.sqrt(dx * dx + dy * dy) < cooldown.shortEdge * SCAN_COOLDOWN_CENTROID_FRACTION) {
            cooldownActive = true;
          } else {
            lastCapture.setBlocking(null);
          }
        }

        // Detection space → Y-plane buffer (the Mat the capture warp reads) → frame space.
        const bufferQuad = activeQuad.map((p) => ({ x: p.x * scalePlane + roiX, y: p.y * scalePlane + roiY })) as Quad;
        const sx = frameW / yWidth;
        const sy = frameH / yHeight;
        const frameQuad = bufferQuad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;

        quad.setBlocking(frameQuad);
        const frameMetrics: DetectionMetrics = {
          ...pipelineMetrics(),
          score: composite,
          stability,
          sharpness,
          coverage,
          brightnessFit,
          brightness: brightnessRaw,
          hasQuad: true,
          hardFloorPass,
          inHysteresis: nowInBand,
          cooldownActive,
          historyDepth: prevHist.length,
        };
        metrics.setBlocking(frameMetrics);

        if (!hardFloorPass || !nowInBand || cooldownActive) {
          stableFrames.setBlocking(0);
          return;
        }

        const nextStable = stableFrames.getDirty() + 1;
        stableFrames.setBlocking(nextStable);
        if (tune.autoCaptureEnabled && nextStable >= tune.minStableFrames) {
          lastCapture.setBlocking({ centroidX, centroidY, shortEdge: shortEdgeDet });

          // Warp the exact frame that passed the gates; `gray` lives until the outer finally's clearBuffers.
          let captureUri = '';
          let captureError = '';
          const warpStartedAt = Date.now();
          try {
            const srcPt0 = OpenCV.createObject(ObjectType.Point2f, bufferQuad[0].x, bufferQuad[0].y);
            const srcPt1 = OpenCV.createObject(ObjectType.Point2f, bufferQuad[1].x, bufferQuad[1].y);
            const srcPt2 = OpenCV.createObject(ObjectType.Point2f, bufferQuad[2].x, bufferQuad[2].y);
            const srcPt3 = OpenCV.createObject(ObjectType.Point2f, bufferQuad[3].x, bufferQuad[3].y);
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
            captureError = truncatedErrorMessage(e);
          }

          resetTracking();
          runOnJS(triggerAutoCapture)(captureUri, frameQuad, { width: frameW, height: frameH }, {
            metrics: frameMetrics,
            stableFrames: nextStable,
            sharpnessRaw,
            bufferQuad,
            bufferSize: { width: yWidth, height: yHeight },
            roi: { x: roiX, y: roiY, width: roiWidth, height: roiHeight },
            warpMs: Date.now() - warpStartedAt,
            error: captureError,
          });
        }
      } finally {
        if (opencvDirty) {
          OpenCV.clearBuffers();
        }
        frame.dispose();
      }
    },
  });

  return { quad, metrics, stableFrames, frameOutput };
}

// --- Pure helpers (worklet-safe). Each is fully self-contained; cross-helper
// calls are forbidden because react-native-worklets does not reliably capture
// sibling helpers into the worklet runtime closure.

function truncatedErrorMessage(e: unknown): string {
  'worklet';
  const raw = e instanceof Error ? e.message : String(e);
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

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
  // No upper penalty: filling the guide is the intended framing; overflow is rejected via ROI_EDGE_MARGIN.
  const fraction = area / (w * h);
  if (fraction <= 0.1) return 0;
  if (fraction < 0.35) return (fraction - 0.1) / 0.25;
  return 1;
}

/** Brightness fit in [0..1]: 1.0 inside [80, 200], ramping linearly to 0 at the hard-floor edges. */
function brightnessFitScore(meanLum: number): number {
  'worklet';
  const HARD_MIN = HARD_FLOORS.brightnessMin;
  const HARD_MAX = HARD_FLOORS.brightnessMax;
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
