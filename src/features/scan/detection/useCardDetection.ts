import { useEffect, useMemo, useRef } from 'react';
import {
  type Frame,
  runAsync,
  runAtTargetFps,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useSharedValue, Worklets, type ISharedValue } from 'react-native-worklets-core';
import {
  ColorConversionCodes,
  ContourApproximationModes,
  DataTypes,
  InterpolationFlags,
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
};

export type CardDetectionParams = {
  enabled: boolean;
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
};

// Aspect-ratio target for an MTG card (2.5" x 3.5"). Matches min(w,h)/max(w,h).
const MTG_ASPECT = 2.5 / 3.5;
const ASPECT_TOLERANCE = 0.18;

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

  const tunables = useSharedValue<{
    enabled: boolean;
    threshold: number;
    minStableFrames: number;
    wStability: number;
    wSharpness: number;
    wCoverage: number;
  }>({
    enabled: params.enabled,
    threshold: params.threshold,
    minStableFrames: params.minStableFrames,
    wStability: params.weightStability,
    wSharpness: params.weightSharpness,
    wCoverage: params.weightCoverage,
  });

  useEffect(() => {
    tunables.value = {
      enabled: params.enabled,
      threshold: params.threshold,
      minStableFrames: params.minStableFrames,
      wStability: params.weightStability,
      wSharpness: params.weightSharpness,
      wCoverage: params.weightCoverage,
    };
  }, [
    tunables,
    params.enabled,
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
        };
        stableFrames.value = 0;
        return;
      }

      runAtTargetFps(15, () => {
        'worklet';
        runAsync(frame, () => {
          'worklet';

          const now = Date.now();
          const dtMs = lastFrameAt.value === 0 ? 0 : now - lastFrameAt.value;
          lastFrameAt.value = now;
          const instantFps = dtMs > 0 ? 1000 / dtMs : 0;
          ema.value = ema.value === 0 ? instantFps : ema.value * 0.85 + instantFps * 0.15;

          const frameW = frame.width;
          const frameH = frame.height;
          const detW = DETECT_WIDTH;
          const detH = Math.round((DETECT_WIDTH * frameH) / frameW);
          const scale = frameW / detW;

          let detectedQuad: Quad | null = null;
          let bestArea = 0;

          try {
            // Frame -> Mat (RGBA, 4 channels)
            const buffer = frame.toArrayBuffer();
            const data = new Uint8Array(buffer);
            const src = OpenCV.frameBufferToMat(frameH, frameW, 4, data);

            const small = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC4);
            const sizeSmall = OpenCV.createObject(ObjectType.Size, detW, detH);
            OpenCV.invoke('resize', src, small, sizeSmall, 0, 0, InterpolationFlags.INTER_AREA);

            const gray = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
            OpenCV.invoke('cvtColor', small, gray, ColorConversionCodes.COLOR_RGBA2GRAY);

            const blurred = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
            const blurKsize = OpenCV.createObject(ObjectType.Size, 5, 5);
            OpenCV.invoke('GaussianBlur', gray, blurred, blurKsize, 0);

            const edges = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
            OpenCV.invoke('Canny', blurred, edges, 50, 150);

            const contours = OpenCV.createObject(ObjectType.MatVector);
            OpenCV.invoke(
              'findContours',
              edges,
              contours,
              RetrievalModes.RETR_EXTERNAL,
              ContourApproximationModes.CHAIN_APPROX_SIMPLE,
            );

            const contourCount = OpenCV.toJSValue(contours).array.length;
            const minArea = detW * detH * 0.15;

            for (let i = 0; i < contourCount; i += 1) {
              const contour = OpenCV.copyObjectFromVector(contours, i);
              const area = OpenCV.invoke('contourArea', contour, false).value;
              if (area < minArea) continue;

              const peri = OpenCV.invoke('arcLength', contour, true).value;
              const approx = OpenCV.createObject(ObjectType.PointVector);
              OpenCV.invoke('approxPolyDP', contour, approx, 0.02 * peri, true);

              const approxJs = OpenCV.toJSValue(approx);
              if (approxJs.array.length !== 4) continue;

              const corners: Quad = [
                { x: approxJs.array[0].x, y: approxJs.array[0].y },
                { x: approxJs.array[1].x, y: approxJs.array[1].y },
                { x: approxJs.array[2].x, y: approxJs.array[2].y },
                { x: approxJs.array[3].x, y: approxJs.array[3].y },
              ];
              const ordered = orderQuadCorners(corners);
              const aspect = quadAspect(ordered);
              if (Math.abs(aspect - MTG_ASPECT) > ASPECT_TOLERANCE) continue;

              if (area > bestArea) {
                bestArea = area;
                detectedQuad = ordered;
              }
            }

            OpenCV.clearBuffers();
          } catch {
            quad.value = null;
            metrics.value = {
              ...INITIAL_METRICS,
              frameSize: { width: frameW, height: frameH },
              detectionFps: ema.value,
            };
            stableFrames.value = 0;
            return;
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
          };

          if (score >= tune.threshold) {
            stableFrames.value = stableFrames.value + 1;
            if (stableFrames.value >= tune.minStableFrames) {
              stableFrames.value = 0;
              tunables.value = { ...tune, enabled: false };
              triggerAutoCapture(frameQuad, { width: frameW, height: frameH });
            }
          } else {
            stableFrames.value = 0;
          }
        });
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
