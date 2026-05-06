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
  /**
   * Re-enable detection after the worklet has self-disabled for an auto-capture
   * that subsequently failed (e.g. camera was mid-rebind after an AppState
   * transition and `capturePhoto` threw "Not bound to a valid Camera"). Without
   * this, detection stays off until the next params.enabled toggle.
   */
  resume: () => void;
  /**
   * Pause the worklet pipeline from JS. Required around `capturePhoto` +
   * `cropToQuad` because both the worklet and `cropToQuad` call
   * `OpenCV.clearBuffers()` on the same global object store; if the worklet
   * keeps running it wipes objects mid-warp ("Object with id … not found in
   * storage"). Auto-capture self-disables in the worklet, but manual capture
   * doesn't, hence this explicit hook.
   */
  pause: () => void;
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
const MTG_SHORT = 2.5;
const MTG_LONG = 3.5;
const ASPECT_TOLERANCE = 0.3;
const MIN_AREA_FRACTION = 0.05;
const FILL_RATIO_MIN = 0.7;
/**
 * Fraction of the buffer's *short* axis that the centered detection-ROI takes.
 * The companion display-side GuideFrame component uses the same fraction so the
 * on-screen guide rectangle aligns with where the worklet actually looks.
 *
 * Sized for a card held at the wide-angle lens's minimum focus distance
 * (~25 cm on a base S23) — at that range the card occupies roughly half the
 * viewport, so a guide much larger than that just trains users to hold the
 * card too close for AF to lock.
 */
export const GUIDE_SHORT_FRACTION = 0.55;
const APPROX_EPSILON_FRACTIONS = [0.02, 0.03, 0.04, 0.05, 0.06] as const;
// Width (long axis) of the downscaled buffer that actually runs through the
// Canny + findContours pipeline. Lower is faster — work scales with pixel
// count, so 360 is ~44% the cost of 480 with no measurable detection-quality
// loss for a card filling most of the ROI. Detected coords are scaled back
// up to buffer-space for the final projection, so this is invisible to the UI.
const DETECT_WIDTH = 360;
const STABILITY_CEILING = 24;
const STABILITY_HISTORY = 8;
/**
 * Per-frame blend factor for the displayed/auto-capture quad. Each frame the
 * smoothed corners are `prev * (1 - alpha) + current * alpha`, so the visible
 * polygon glides toward the latest detection instead of snapping to it. This
 * cuts the corner jitter that prevented `stabilityScore` from clearing the
 * auto-capture threshold.
 */
const QUAD_SMOOTH_ALPHA = 0.4;
/**
 * Brief detection drops (1–2 frames) shouldn't reset the smoothed quad — that
 * just resets the auto-capture progress. We hold the last smoothed quad alive
 * for this many frames; only after a sustained miss do we clear it.
 */
const QUAD_SMOOTH_GRACE_FRAMES = 2;

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
  // Smoothed quad in detection-space coords (pre-projection). Persists across
  // brief detection drops so a 1-frame miss doesn't kill auto-capture progress.
  const smoothedDetQuad = useSyncedValue<Quad | null>(null);
  const smoothMissCount = useSyncedValue<number>(0);

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
          // Clear smoothing state so a future re-enable starts fresh — otherwise
          // stale corners from before disable bias the first re-acquired quad.
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
        // Y-plane derived dims; populated inside the try block once we have the
        // actual buffer dimensions. Declared here so they're visible to the
        // post-try success path that projects the detected quad back into
        // frame-space coords.
        let yWidth = 0;
        let yHeight = 0;
        let detWPlane = 0;
        let detHPlane = 0;
        let scalePlane = 1;
        // ROI offsets in buffer coords; needed to add back when projecting
        // detection-space contour coords to buffer coords post-detection.
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

          // Crop the gray Mat to a centered MTG-aspect ROI so detection happens
          // only inside the on-screen guide rectangle. This eliminates noisy
          // edges from outside the card area (table, hand, shadows) and
          // dramatically tightens the resulting bounding box. The display-side
          // GuideFrame component renders the same proportions so the user
          // visually lines up the card with where detection runs.
          //
          // Buffer is in landscape sensor orientation; the card is rotated 90°
          // in the buffer (long axis along x). MTG portrait aspect is 0.714
          // (W/H), so in buffer coords the *long* axis is horizontal: target
          // ROI aspect = H_card/W_card = 1/0.714 = 1.4 (W_buffer/H_buffer).
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

          // Detection-space dims sized off the *ROI* now, not the full Y-plane.
          // scalePlane maps detection-space → ROI coords; (roiX, roiY) maps
          // ROI coords → buffer coords.
          detWPlane = Math.min(DETECT_WIDTH, roiW);
          detHPlane = Math.round((detWPlane * roiH) / roiW);
          scalePlane = roiW / detWPlane;

          lastStep = 'createSmall';
          const small = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
          const sizeSmall = OpenCV.createObject(ObjectType.Size, detWPlane, detHPlane);
          lastStep = 'resize';
          OpenCV.invoke('resize', grayRoi, small, sizeSmall, 0, 0, InterpolationFlags.INTER_AREA);

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

            // Use minAreaRect's corners (a clean rotated rectangle).
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
          return;
        } finally {
          OpenCV.clearBuffers();
        }

        // Smooth the detection-space quad with a per-corner EMA so frame-to-frame
        // jitter doesn't tank stability. On a missed frame, hold the previous
        // smoothed quad alive for QUAD_SMOOTH_GRACE_FRAMES before clearing —
        // that prevents 1-frame detection drops from resetting auto-capture.
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
        prevHist.push(activeQuad);
        if (prevHist.length > STABILITY_HISTORY) prevHist.shift();
        history.setBlocking(prevHist);

        const stability = stabilityScore(activeQuad, prevHist);
        const sharpness = 0;
        const coverage = coverageScore(activeQuad, detWPlane, detHPlane);

        const score =
          tune.wStability * stability +
          tune.wSharpness * sharpness +
          tune.wCoverage * coverage;

        // Project detection-space coords back into frame-space.
        // Pipeline: detection-space → ROI coords (× scalePlane), then
        // ROI → buffer coords (+ roiX, roiY), then buffer → frame (× sx, sy).
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

  const resume = () => {
    const cur = tunables.getDirty();
    if (!cur.enabled) {
      tunables.setBlocking({ ...cur, enabled: true });
      stableFrames.setBlocking(0);
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
  // Find TL/TR/BR/BL by comparing sum (x+y) and diff (y-x) of each corner.
  // These are *image-aligned* corners — i.e. sorted by their position in the
  // image, NOT by which corner of the card they correspond to. For a portrait
  // card photographed in a landscape sensor frame, the card's "top" is along
  // one of the short image edges, so the image-aligned ordering would treat a
  // *card-side* corner as TL. The perspective transform downstream would then
  // rotate the warped output. We detect that case below by comparing the
  // quad's width-vs-height in image space, and rotate the corner array so the
  // card's own top edge ends up mapping to the output's top edge.
  // Inline the index searches to avoid cross-function calls from within the
  // worklet runtime — react-native-worklets does not always capture sibling
  // helpers into the worklet closure, which produced the
  //   "indexOfMin is not a function (it is undefined)"
  // error in the camera thread.
  const s0 = q[0].x + q[0].y;
  const s1 = q[1].x + q[1].y;
  const s2 = q[2].x + q[2].y;
  const s3 = q[3].x + q[3].y;
  const d0 = q[0].y - q[0].x;
  const d1 = q[1].y - q[1].x;
  const d2 = q[2].y - q[2].x;
  const d3 = q[3].y - q[3].x;
  let tlIdx = 0;
  if (s1 < q[tlIdx].x + q[tlIdx].y) tlIdx = 1;
  if (s2 < q[tlIdx].x + q[tlIdx].y) tlIdx = 2;
  if (s3 < q[tlIdx].x + q[tlIdx].y) tlIdx = 3;
  let brIdx = 0;
  if (s1 > q[brIdx].x + q[brIdx].y) brIdx = 1;
  if (s2 > q[brIdx].x + q[brIdx].y) brIdx = 2;
  if (s3 > q[brIdx].x + q[brIdx].y) brIdx = 3;
  let trIdx = 0;
  if (d1 < q[trIdx].y - q[trIdx].x) trIdx = 1;
  if (d2 < q[trIdx].y - q[trIdx].x) trIdx = 2;
  if (d3 < q[trIdx].y - q[trIdx].x) trIdx = 3;
  let blIdx = 0;
  if (d1 > q[blIdx].y - q[blIdx].x) blIdx = 1;
  if (d2 > q[blIdx].y - q[blIdx].x) blIdx = 2;
  if (d3 > q[blIdx].y - q[blIdx].x) blIdx = 3;
  // Reference s0/d0 to keep them live in case the optimizer is aggressive.
  void s0;
  void d0;
  const tl = q[tlIdx];
  const tr = q[trIdx];
  const br = q[brIdx];
  const bl = q[blIdx];

  // Detect "card rotated in image" case: image-aligned width > height means
  // the card's long axis is along the image x-axis, i.e. its actual top edge
  // is one of the image's *side* edges. Rotate the corner array so the
  // perspective transform maps the card's true top edge to the output top.
  let dx = tl.x - tr.x; let dy = tl.y - tr.y;
  const widthA = Math.sqrt(dx * dx + dy * dy);
  dx = tl.x - bl.x; dy = tl.y - bl.y;
  const heightA = Math.sqrt(dx * dx + dy * dy);
  if (widthA > heightA) {
    // Card's long axis lies along the image's x-axis — i.e. portrait card in
    // a landscape sensor frame. Rotate the corner array 90° CCW so the card's
    // own top edge maps to the perspective-transform's destination top edge.
    // (90° CW first attempt produced upside-down output on Galaxy S23 — the
    // sensor mount direction means the card's actual top is on the LEFT side
    // of the buffer, which is image-BL/TL in our axis-aligned ordering.)
    return [bl, tl, tr, br];
  }
  return [tl, tr, br, bl];
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

// All helpers below are 'worklet'-tagged AND avoid calling each other —
// react-native-worklets sometimes fails to capture sibling helpers into the
// worklet runtime closure (we hit "polygonArea is not a function" and
// "indexOfMin is not a function" before). Each function is now self-contained.

function quadAspect(q: Quad): number {
  'worklet';
  // Inline dist for top/bottom/left/right edges.
  let dx: number; let dy: number;
  dx = q[0].x - q[1].x; dy = q[0].y - q[1].y;
  const top = Math.sqrt(dx * dx + dy * dy);
  dx = q[3].x - q[2].x; dy = q[3].y - q[2].y;
  const bottom = Math.sqrt(dx * dx + dy * dy);
  dx = q[0].x - q[3].x; dy = q[0].y - q[3].y;
  const left = Math.sqrt(dx * dx + dy * dy);
  dx = q[1].x - q[2].x; dy = q[1].y - q[2].y;
  const right = Math.sqrt(dx * dx + dy * dy);
  const w = (top + bottom) / 2;
  const h = (left + right) / 2;
  if (w <= 0 || h <= 0) return 0;
  const longer = w > h ? w : h;
  const shorter = w > h ? h : w;
  return shorter / longer;
}

function stabilityScore(current: Quad, history: Quad[]): number {
  'worklet';
  if (history.length < 2) return 0;
  let total = 0;
  let samples = 0;
  for (let i = 0; i < history.length - 1; i += 1) {
    const prev = history[i];
    for (let c = 0; c < 4; c += 1) {
      // Inline dist.
      const dx = prev[c].x - current[c].x;
      const dy = prev[c].y - current[c].y;
      total += Math.sqrt(dx * dx + dy * dy);
      samples += 1;
    }
  }
  const avg = samples > 0 ? total / samples : STABILITY_CEILING;
  // Inline clamp01.
  const ratio = 1 - avg / STABILITY_CEILING;
  if (!Number.isFinite(ratio)) return 0;
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

function coverageScore(quad: Quad, w: number, h: number): number {
  'worklet';
  // Inline polygonArea (shoelace formula on the 4 corners).
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
