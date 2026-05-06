import { useEffect, useRef } from 'react';
import {
  type CameraFrameOutput,
  type Frame,
  useFrameOutput,
} from 'react-native-vision-camera';
import { runOnJS, type Synchronizable } from 'react-native-worklets';
import {
  ColorConversionCodes,
  ContourApproximationModes,
  DataTypes,
  InterpolationFlags,
  MorphShapes,
  MorphTypes,
  ObjectType,
  OpenCV,
  RetrievalModes,
} from 'react-native-fast-opencv';
import { useSyncedValue } from './useSyncedValue';

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];

export type FrameSize = { width: number; height: number };

export type DetectionMetrics = {
  score: number;
  stability: number;
  sharpness: number;
  coverage: number;
  detectionFps: number;
  frameSize: FrameSize;
  hasQuad: boolean;
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
  onAutoCapture: (quad: Quad, frameSize: FrameSize) => void;
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
  detectionFps: 0,
  frameSize: { width: 0, height: 0 },
  hasQuad: false,
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
const ASPECT_TOLERANCE = 0.3;
const MIN_AREA_FRACTION = 0.05;
const FILL_RATIO_MIN = 0.7;
const APPROX_EPSILON_FRACTIONS = [0.02, 0.03, 0.04, 0.05, 0.06] as const;
const DETECT_WIDTH = 480;
const STABILITY_CEILING = 24;
const STABILITY_HISTORY = 8;

/**
 * Per-frame card detection pipeline (vision-camera v5 / new arch):
 *   downscale -> grayscale -> blur -> Canny -> morphClose -> findContours
 *   -> filter by minAreaRect fill-ratio + aspect
 *   -> recover trapezoid corners via approxPolyDP with adaptive epsilon
 *   -> rank by area
 *
 * The Camera mounting this output MUST set `pixelFormat="rgb"` so frames arrive
 * as 4-channel RGBA, which `bufferToMat` then loads.
 *
 * Frame disposal is mandatory in v5; the `finally` block calls `frame.dispose()`
 * after `OpenCV.clearBuffers()` regardless of success/failure.
 */
export function useCardDetection(params: CardDetectionParams): CardDetectionState {
  const quad = useSyncedValue<Quad | null>(null);
  const metrics = useSyncedValue<DetectionMetrics>(INITIAL_METRICS);
  const stableFrames = useSyncedValue<number>(0);
  const history = useSyncedValue<Quad[]>([]);
  const lastFrameAt = useSyncedValue<number>(0);
  const ema = useSyncedValue<number>(0);
  const framesProcessedShared = useSyncedValue<number>(0);

  const tunables = useSyncedValue<{
    enabled: boolean;
    autoCaptureEnabled: boolean;
    threshold: number;
    minStableFrames: number;
    wStability: number;
    wSharpness: number;
    wCoverage: number;
  }>({
    enabled: params.enabled,
    autoCaptureEnabled: params.autoCaptureEnabled,
    threshold: params.threshold,
    minStableFrames: params.minStableFrames,
    wStability: params.weightStability,
    wSharpness: params.weightSharpness,
    wCoverage: params.weightCoverage,
  });

  useEffect(() => {
    tunables.setBlocking({
      enabled: params.enabled,
      autoCaptureEnabled: params.autoCaptureEnabled,
      threshold: params.threshold,
      minStableFrames: params.minStableFrames,
      wStability: params.weightStability,
      wSharpness: params.weightSharpness,
      wCoverage: params.weightCoverage,
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
  ]);

  const onAutoCaptureRef = useRef(params.onAutoCapture);
  onAutoCaptureRef.current = params.onAutoCapture;

  const triggerAutoCapture = (q: Quad, size: FrameSize) => {
    onAutoCaptureRef.current(q, size);
  };

  const frameOutput = useFrameOutput({
    // YUV is the camera's native format on Android, so this is zero-conversion
    // and avoids the 'unknown' fallback we observed when requesting 'rgb' on
    // Galaxy S23. We only need luminance for edge detection — the Y plane is
    // already grayscale, so we can skip cvtColor entirely.
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    onFrame: (frame: Frame) => {
      'worklet';

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
        // Y-plane derived dims; populated inside the try block once we have the
        // actual buffer dimensions. Declared here so they're visible to the
        // post-try success path that projects the detected quad back into
        // frame-space coords.
        let yWidth = 0;
        let yHeight = 0;
        let detWPlane = 0;
        let detHPlane = 0;
        let scalePlane = 1;

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
        const framesProcessedNow = framesProcessedShared.getDirty() + 1;
        framesProcessedShared.setBlocking(framesProcessedNow);

        let pipelineError = '';
        try {
          // Defensive sanity checks before touching OpenCV — feeding bufferToMat
          // a buffer of the wrong size is what segfaulted on the Galaxy S23
          // when pixelFormat fell through to 'unknown'.
          if (!frame.isPlanar) {
            // We requested 'yuv' which should always be planar on Android. If
            // the runtime delivers something else, skip rather than crash.
            lastStep = 'skip:not-planar';
            return;
          }
          const planes = frame.getPlanes();
          if (planes.length === 0) {
            lastStep = 'skip:no-planes';
            return;
          }
          // Plane 0 is the Y (luminance) plane in YUV — already grayscale,
          // exactly what edge detection needs. Skip RGBA→Gray conversion.
          const yPlane = planes[0];
          yWidth = yPlane.width;
          yHeight = yPlane.height;
          const yBytesPerRow = yPlane.bytesPerRow;

          lastStep = 'getPixelBuffer';
          const buffer = yPlane.getPixelBuffer();
          lastBufferBytes = buffer.byteLength;

          // Validate the buffer size matches what bufferToMat will read so we
          // never walk past the end. Stride may be > yWidth due to alignment.
          const expectedPadded = yBytesPerRow * yHeight;
          if (buffer.byteLength < expectedPadded) {
            lastStep = `skip:short-buffer(got=${buffer.byteLength},need=${expectedPadded})`;
            return;
          }

          lastStep = 'Uint8Array';
          const data = new Uint8Array(buffer);

          // Build a tight (no-padding) grayscale Mat. When the plane stride
          // matches its width, we wrap zero-copy. When there's row padding we
          // copy each row's data columns into a fresh contiguous buffer —
          // ~1MB at 1280x720, cheap.
          lastStep = 'bufferToMat';
          let gray;
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

          // Detection-space dims sized off the Y-plane (the actual buffer dims
          // we just wrapped).
          detWPlane = Math.min(DETECT_WIDTH, yWidth);
          detHPlane = Math.round((detWPlane * yHeight) / yWidth);
          scalePlane = yWidth / detWPlane;

          lastStep = 'createSmall';
          const small = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
          const sizeSmall = OpenCV.createObject(ObjectType.Size, detWPlane, detHPlane);
          lastStep = 'resize';
          OpenCV.invoke('resize', gray, small, sizeSmall, 0, 0, InterpolationFlags.INTER_AREA);

          lastStep = 'GaussianBlur';
          const blurred = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
          const blurKsize = OpenCV.createObject(ObjectType.Size, 5, 5);
          // Blur the resized `small` (detection-space gray), not the full-size `gray`.
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

            const peri = OpenCV.invoke('arcLength', contour, true).value;
            let corners: Quad | null = null;
            for (const fraction of APPROX_EPSILON_FRACTIONS) {
              const approx = OpenCV.createObject(ObjectType.PointVector);
              OpenCV.invoke('approxPolyDP', contour, approx, fraction * peri, true);
              const pts = OpenCV.toJSValue(approx).array;
              if (pts.length === 4) {
                corners = [
                  { x: pts[0].x, y: pts[0].y },
                  { x: pts[1].x, y: pts[1].y },
                  { x: pts[2].x, y: pts[2].y },
                  { x: pts[3].x, y: pts[3].y },
                ];
                break;
              }
            }
            if (!corners) {
              corners = rotatedRectCorners(
                rrectJs.centerX,
                rrectJs.centerY,
                rrectJs.width,
                rrectJs.height,
                rrectJs.angle,
              );
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
          return;
        } finally {
          OpenCV.clearBuffers();
        }

        if (!detectedQuad) {
          quad.setBlocking(null);
          history.setBlocking([]);
          stableFrames.setBlocking(0);
          metrics.setBlocking({
            score: 0,
            stability: 0,
            sharpness: 0,
            coverage: 0,
            detectionFps: newEma,
            frameSize: { width: frameW, height: frameH },
            hasQuad: false,
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

        const prevHist = history.getDirty().slice();
        prevHist.push(detectedQuad);
        if (prevHist.length > STABILITY_HISTORY) prevHist.shift();
        history.setBlocking(prevHist);

        const stability = stabilityScore(detectedQuad, prevHist);
        const sharpness = 0;
        const coverage = coverageScore(detectedQuad, detWPlane, detHPlane);

        const score =
          tune.wStability * stability +
          tune.wSharpness * sharpness +
          tune.wCoverage * coverage;

        // Project detection-space coords (Y-plane sensor space) back into
        // frame-space (frame.width × frame.height) for the overlay and
        // post-capture cropToQuad. When sensor and frame dims agree this is
        // a uniform scale; if they ever disagree (rotation), the overlay will
        // be off but detection still works for upload-cropping.
        const sx = frameW / yWidth;
        const sy = frameH / yHeight;
        const frameQuad: Quad = [
          { x: detectedQuad[0].x * scalePlane * sx, y: detectedQuad[0].y * scalePlane * sy },
          { x: detectedQuad[1].x * scalePlane * sx, y: detectedQuad[1].y * scalePlane * sy },
          { x: detectedQuad[2].x * scalePlane * sx, y: detectedQuad[2].y * scalePlane * sy },
          { x: detectedQuad[3].x * scalePlane * sx, y: detectedQuad[3].y * scalePlane * sy },
        ];

        quad.setBlocking(frameQuad);
        metrics.setBlocking({
          score,
          stability,
          sharpness,
          coverage,
          detectionFps: newEma,
          frameSize: { width: frameW, height: frameH },
          hasQuad: true,
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

        if (score >= tune.threshold) {
          const nextStable = stableFrames.getDirty() + 1;
          stableFrames.setBlocking(nextStable);
          if (tune.autoCaptureEnabled && nextStable >= tune.minStableFrames) {
            stableFrames.setBlocking(0);
            tunables.setBlocking({ ...tune, enabled: false });
            runOnJS(triggerAutoCapture)(frameQuad, { width: frameW, height: frameH });
          }
        } else {
          stableFrames.setBlocking(0);
        }
      } finally {
        // v5 requires explicit Frame disposal; otherwise the camera pipeline stalls.
        frame.dispose();
      }
    },
  });

  return { quad, metrics, stableFrames, frameOutput };
}

// --- Pure helpers (worklet-safe).

function clamp01(n: number): number {
  'worklet';
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function orderQuadCorners(q: Quad): Quad {
  'worklet';
  const sums = [q[0].x + q[0].y, q[1].x + q[1].y, q[2].x + q[2].y, q[3].x + q[3].y];
  const diffs = [q[0].y - q[0].x, q[1].y - q[1].x, q[2].y - q[2].x, q[3].y - q[3].x];
  const tl = q[indexOfMin(sums)];
  const br = q[indexOfMax(sums)];
  const tr = q[indexOfMin(diffs)];
  const bl = q[indexOfMax(diffs)];
  return [tl, tr, br, bl];
}

function indexOfMin(arr: number[]): number {
  'worklet';
  let best = 0;
  for (let i = 1; i < arr.length; i += 1) {
    if (arr[i] < arr[best]) best = i;
  }
  return best;
}

function indexOfMax(arr: number[]): number {
  'worklet';
  let best = 0;
  for (let i = 1; i < arr.length; i += 1) {
    if (arr[i] > arr[best]) best = i;
  }
  return best;
}

function rotatedRectCorners(
  cx: number,
  cy: number,
  width: number,
  height: number,
  angleDeg: number,
): Quad {
  'worklet';
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = width / 2;
  const hh = height / 2;
  const offsets: Point[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  return [
    { x: cx + offsets[0].x * cos - offsets[0].y * sin, y: cy + offsets[0].x * sin + offsets[0].y * cos },
    { x: cx + offsets[1].x * cos - offsets[1].y * sin, y: cy + offsets[1].x * sin + offsets[1].y * cos },
    { x: cx + offsets[2].x * cos - offsets[2].y * sin, y: cy + offsets[2].x * sin + offsets[2].y * cos },
    { x: cx + offsets[3].x * cos - offsets[3].y * sin, y: cy + offsets[3].x * sin + offsets[3].y * cos },
  ];
}

function quadAspect(q: Quad): number {
  'worklet';
  const top = dist(q[0], q[1]);
  const bottom = dist(q[3], q[2]);
  const left = dist(q[0], q[3]);
  const right = dist(q[1], q[2]);
  const w = (top + bottom) / 2;
  const h = (left + right) / 2;
  if (w <= 0 || h <= 0) return 0;
  const longer = w > h ? w : h;
  const shorter = w > h ? h : w;
  return shorter / longer;
}

function dist(a: Point, b: Point): number {
  'worklet';
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function stabilityScore(current: Quad, history: Quad[]): number {
  'worklet';
  if (history.length < 2) return 0;
  let total = 0;
  let samples = 0;
  for (let i = 0; i < history.length - 1; i += 1) {
    const prev = history[i];
    for (let c = 0; c < 4; c += 1) {
      total += dist(prev[c], current[c]);
      samples += 1;
    }
  }
  const avg = samples > 0 ? total / samples : STABILITY_CEILING;
  return clamp01(1 - avg / STABILITY_CEILING);
}

function coverageScore(quad: Quad, w: number, h: number): number {
  'worklet';
  const area = polygonArea(quad);
  const fraction = area / (w * h);
  if (fraction <= 0.1) return 0;
  if (fraction >= 0.9) return 0;
  if (fraction < 0.35) return (fraction - 0.1) / 0.25;
  if (fraction > 0.65) return 1 - (fraction - 0.65) / 0.25;
  return 1;
}

function polygonArea(q: Quad): number {
  'worklet';
  const [a, b, c, d] = q;
  return (
    Math.abs(
      a.x * b.y - b.x * a.y + (b.x * c.y - c.x * b.y) + (c.x * d.y - d.x * c.y) + (d.x * a.y - a.x * d.y),
    ) / 2
  );
}
