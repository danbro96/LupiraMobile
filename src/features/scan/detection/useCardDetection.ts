import { useEffect, useMemo, useRef } from 'react';
import {
  type Frame,
  runAtTargetFps,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useSharedValue, Worklets, type ISharedValue } from 'react-native-worklets-core';
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
  /** Contours whose area passed MIN_AREA_FRACTION. */
  largeContourCount: number;
  /** Vertex count of the approxPolyDP of the largest contour seen this frame. */
  bestApproxVertexCount: number;
  /** Aspect ratio (shorter/longer) of the largest contour's quad approx, or 0. */
  bestApproxAspect: number;
  /** Counter of how many times the worklet body has entered runAsync. */
  framesProcessed: number;
  /** Byte length of the most recent ArrayBuffer pulled from the frame. */
  lastBufferBytes: number;
  /** Last error string from the OpenCV pipeline ('' on success). */
  lastError: string;
  /** Name of the last successful pipeline step before any error/no-result. */
  lastStep: string;
};

export type CardDetectionParams = {
  /** Whether the detection pipeline should run at all (camera screen active). */
  enabled: boolean;
  /** Whether to trigger auto-capture once the score has held above threshold. */
  autoCaptureEnabled: boolean;
  threshold: number;
  minStableFrames: number;
  weightStability: number;
  weightSharpness: number;
  weightCoverage: number;
  onAutoCapture: (quad: Quad, frameSize: FrameSize) => void;
};

export type CardDetectionState = {
  quad: ISharedValue<Quad | null>;
  metrics: ISharedValue<DetectionMetrics>;
  stableFrames: ISharedValue<number>;
  frameProcessor: ReturnType<typeof useFrameProcessor>;
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

// Aspect-ratio target for an MTG card (2.5" x 3.5"). Matches min(w,h)/max(w,h).
const MTG_ASPECT = 2.5 / 3.5;
const ASPECT_TOLERANCE = 0.3;

// Fraction of the detection frame the card must cover to be considered.
const MIN_AREA_FRACTION = 0.05;

// Required ratio of (contour area) / (min-area-rect area) for a contour to be
// considered card-shaped. Real cards fill > 0.85 of their bounding rectangle
// when shot flat, ~0.75-0.85 at typical hand-held tilts, ~0.70 at heavy
// perspective. L-shapes, table edges, and clutter sit well below 0.7.
const FILL_RATIO_MIN = 0.7;

// Epsilon fractions tried in order when searching for a 4-point polygon
// approximation. Smaller = tighter fit (more vertices); larger = looser.
const APPROX_EPSILON_FRACTIONS = [0.02, 0.03, 0.04, 0.05, 0.06] as const;

// Width to which frames are downscaled before contour finding.
const DETECT_WIDTH = 480;

// Per-corner average pixel-distance ceiling used to normalize stability.
const STABILITY_CEILING = 24;

// Rolling history depth for stability estimation.
const STABILITY_HISTORY = 8;

/**
 * Per-frame card detection pipeline:
 *   downscale -> grayscale -> blur -> Canny -> findContours
 *   -> approxPolyDP -> filter to convex 4-pt quads with MTG aspect
 *   -> rank by area
 *   -> compute stability and coverage scores (sharpness reserved; always 0 for v1)
 *
 * The frame processor writes shared values that drive both the Skia overlay
 * and the auto-capture trigger. JS-side React state is intentionally NOT
 * updated each frame; the overlay reads the shared values directly.
 *
 * The Camera mounting this processor MUST be set to `pixelFormat="rgb"` so
 * frames arrive as 4-channel RGBA, which `frameBufferToMat` then loads.
 */
export function useCardDetection(params: CardDetectionParams): CardDetectionState {
  const quad = useSharedValue<Quad | null>(null);
  const metrics = useSharedValue<DetectionMetrics>(INITIAL_METRICS);
  const stableFrames = useSharedValue<number>(0);

  const history = useSharedValue<Quad[]>([]);
  const lastFrameAt = useSharedValue<number>(0);
  const ema = useSharedValue<number>(0);
  const framesProcessedShared = useSharedValue<number>(0);

  const tunables = useSharedValue<{
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
    tunables.value = {
      enabled: params.enabled,
      autoCaptureEnabled: params.autoCaptureEnabled,
      threshold: params.threshold,
      minStableFrames: params.minStableFrames,
      wStability: params.weightStability,
      wSharpness: params.weightSharpness,
      wCoverage: params.weightCoverage,
    };
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

  const triggerAutoCapture = useMemo(
    () =>
      Worklets.createRunOnJS((q: Quad, size: FrameSize) => {
        onAutoCaptureRef.current(q, size);
      }),
    [],
  );

  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';

      const tune = tunables.value;
      if (!tune.enabled) {
        quad.value = null;
        metrics.value = {
          ...INITIAL_METRICS,
          frameSize: { width: frame.width, height: frame.height },
          pixelFormat: frame.pixelFormat,
          orientation: frame.orientation,
          isMirrored: frame.isMirrored,
          bytesPerRow: frame.bytesPerRow,
          planesCount: frame.planesCount,
          framesProcessed: framesProcessedShared.value,
          lastStep: 'detection-disabled',
        };
        stableFrames.value = 0;
        return;
      }

      runAtTargetFps(15, () => {
        'worklet';
        // Process synchronously on the camera thread. runAsync was queuing work
        // faster than OpenCV could finish on Android, causing native crashes.
        (() => {
          'worklet';

          const now = Date.now();
          const dtMs = lastFrameAt.value === 0 ? 0 : now - lastFrameAt.value;
          lastFrameAt.value = now;
          const instantFps = dtMs > 0 ? 1000 / dtMs : 0;
          ema.value = ema.value === 0 ? instantFps : ema.value * 0.85 + instantFps * 0.15;

          const frameW = frame.width;
          const frameH = frame.height;
          // Don't upscale tiny preview frames — that just softens edges.
          const detW = Math.min(DETECT_WIDTH, frameW);
          const detH = Math.round((detW * frameH) / frameW);
          const scale = frameW / detW;
          const framePixelFormat = frame.pixelFormat;
          const frameOrientation = frame.orientation;
          const frameIsMirrored = frame.isMirrored;
          const frameBytesPerRow = frame.bytesPerRow;
          const framePlanesCount = frame.planesCount;

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
          framesProcessedShared.value = framesProcessedShared.value + 1;
          const framesProcessedNow = framesProcessedShared.value;

          let pipelineError = '';
          try {
            lastStep = 'toArrayBuffer';
            const buffer = frame.toArrayBuffer();
            lastBufferBytes = buffer.byteLength;
            lastStep = 'Uint8Array';
            const data = new Uint8Array(buffer);
            lastStep = 'bufferToMat';
            const src = OpenCV.bufferToMat('uint8', frameH, frameW, 4, data);

            lastStep = 'createSmall';
            const small = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC4);
            const sizeSmall = OpenCV.createObject(ObjectType.Size, detW, detH);
            lastStep = 'resize';
            OpenCV.invoke('resize', src, small, sizeSmall, 0, 0, InterpolationFlags.INTER_AREA);

            lastStep = 'cvtColor';
            const gray = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
            OpenCV.invoke('cvtColor', small, gray, ColorConversionCodes.COLOR_RGBA2GRAY);

            lastStep = 'GaussianBlur';
            const blurred = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
            const blurKsize = OpenCV.createObject(ObjectType.Size, 5, 5);
            OpenCV.invoke('GaussianBlur', gray, blurred, blurKsize, 0);

            lastStep = 'Canny';
            const edges = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
            OpenCV.invoke('Canny', blurred, edges, 30, 100);

            lastStep = 'morphClose';
            // Bridge tiny gaps in the Canny output so card outlines close into a
            // single contour. 5x5 rect kernel is enough for typical-noise frames.
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
            const minArea = detW * detH * MIN_AREA_FRACTION;

            for (let i = 0; i < contourCount; i += 1) {
              const contour = OpenCV.copyObjectFromVector(contours, i);
              const area = OpenCV.invoke('contourArea', contour, false).value;
              if (area < minArea) continue;
              largeContourCount += 1;

              // minAreaRect always returns a rectangle; check whether the
              // contour actually fills it (cards do; L-shapes and noise don't).
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
                bestApproxVertexCount = Math.round(fillRatio * 100); // re-purposed as fill-ratio %
                bestApproxAspect = aspect;
              }

              if (fillRatio < FILL_RATIO_MIN) continue;
              if (Math.abs(aspect - MTG_ASPECT) > ASPECT_TOLERANCE) continue;

              // Try to recover the true 4-corner outline (handles trapezoid
              // shapes from perspective-tilted shots). Fall back to the bounding
              // rectangle's corners if no epsilon yields exactly 4 vertices.
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
            // Cap length so long native error strings can't blow up Text layout.
            pipelineError = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
            quad.value = null;
            metrics.value = {
              ...INITIAL_METRICS,
              frameSize: { width: frameW, height: frameH },
              detectionFps: ema.value,
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
            };
            stableFrames.value = 0;
            return;
          } finally {
            // Always release native Mats. Without this, a thrown frame leaks
            // ~12 Mats which builds into native OOM and a hard crash.
            OpenCV.clearBuffers();
          }

          if (!detectedQuad) {
            quad.value = null;
            history.value = [];
            stableFrames.value = 0;
            metrics.value = {
              score: 0,
              stability: 0,
              sharpness: 0,
              coverage: 0,
              detectionFps: ema.value,
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
            };
            return;
          }

          const hist = history.value.slice();
          hist.push(detectedQuad);
          if (hist.length > STABILITY_HISTORY) hist.shift();
          history.value = hist;

          const stability = stabilityScore(detectedQuad, hist);
          const sharpness = 0; // TODO: Laplacian-variance focus measure once verified on-device.
          const coverage = coverageScore(detectedQuad, detW, detH);

          const score =
            tune.wStability * stability +
            tune.wSharpness * sharpness +
            tune.wCoverage * coverage;

          // Detection-space -> frame-space.
          const frameQuad: Quad = [
            { x: detectedQuad[0].x * scale, y: detectedQuad[0].y * scale },
            { x: detectedQuad[1].x * scale, y: detectedQuad[1].y * scale },
            { x: detectedQuad[2].x * scale, y: detectedQuad[2].y * scale },
            { x: detectedQuad[3].x * scale, y: detectedQuad[3].y * scale },
          ];

          quad.value = frameQuad;
          metrics.value = {
            score,
            stability,
            sharpness,
            coverage,
            detectionFps: ema.value,
            frameSize: { width: frameW, height: frameH },
            hasQuad: true,
            pixelFormat: framePixelFormat,
            orientation: frameOrientation,
            isMirrored: frameIsMirrored,
            bytesPerRow: frameBytesPerRow,
            planesCount: framePlanesCount,
            contourCount: contourCountForMetrics,
            candidateQuadCount,
            historyDepth: hist.length,
            edgePixelCount,
            framesProcessed: framesProcessedNow,
            lastBufferBytes,
            lastError: pipelineError,
            lastStep,
            largeContourCount,
            bestApproxVertexCount,
            bestApproxAspect,
          };

          if (score >= tune.threshold) {
            stableFrames.value = stableFrames.value + 1;
            if (tune.autoCaptureEnabled && stableFrames.value >= tune.minStableFrames) {
              stableFrames.value = 0;
              tunables.value = { ...tune, enabled: false };
              triggerAutoCapture(frameQuad, { width: frameW, height: frameH });
            }
          } else {
            stableFrames.value = 0;
          }
        })();
      });
    },
    [tunables, quad, metrics, stableFrames, history, lastFrameAt, ema, triggerAutoCapture],
  );

  return { quad, metrics, stableFrames, frameProcessor };
}

// --- Pure helpers (worklet-callable).

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
