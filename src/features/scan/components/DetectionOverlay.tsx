import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';
import type { ISharedValue } from 'react-native-worklets-core';
import type { DetectionMetrics, FrameSize, Quad } from '../detection/useCardDetection';

const ACCENT = '#3b82f6';
const ACCENT_BRIGHT = '#60a5fa';

type Props = {
  quad: ISharedValue<Quad | null>;
  metrics: ISharedValue<DetectionMetrics>;
  stableFrames: ISharedValue<number>;
  /** Width of the overlay container in screen pixels. */
  containerWidth: number;
  /** Height of the overlay container in screen pixels. */
  containerHeight: number;
  /** Threshold (0..1) the score has to meet to feed the countdown ring. */
  threshold: number;
  /** Number of consecutive stable frames required before auto-capture fires. */
  minStableFrames: number;
};

/**
 * Reads worklet shared values via a JS-thread tick and renders the detected
 * quad and a corner-ring countdown indicator. Resampling at ~30fps keeps the
 * overlay smooth without forcing a re-render every camera frame.
 */
export function DetectionOverlay({
  quad,
  metrics,
  stableFrames,
  containerWidth,
  containerHeight,
  threshold,
  minStableFrames,
}: Props) {
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

  const m = metrics.value;
  const q = quad.value;
  const stable = stableFrames.value;

  if (!q || !m.hasQuad || m.frameSize.width === 0 || m.frameSize.height === 0) {
    return null;
  }

  const projected = projectQuad(q, m.frameSize, containerWidth, containerHeight);
  const polygonPoints = projected.map((p) => `${p.x},${p.y}`).join(' ');

  const meetsThreshold = m.score >= threshold;
  const fillProgress = meetsThreshold ? Math.min(1, stable / Math.max(1, minStableFrames)) : 0;

  return (
    <View pointerEvents="none" style={[styles.container, { width: containerWidth, height: containerHeight }]}>
      <Svg width={containerWidth} height={containerHeight}>
        <Polygon
          points={polygonPoints}
          stroke={meetsThreshold ? ACCENT_BRIGHT : ACCENT}
          strokeWidth={meetsThreshold ? 3.5 : 2.25}
          strokeOpacity={0.95}
          fill={ACCENT}
          fillOpacity={meetsThreshold ? 0.12 : 0.05}
        />
        {projected.map((p, idx) => (
          <CornerRing
            key={idx}
            cx={p.x}
            cy={p.y}
            progress={fillProgress}
            active={meetsThreshold}
          />
        ))}
      </Svg>
    </View>
  );
}

function CornerRing({
  cx,
  cy,
  progress,
  active,
}: {
  cx: number;
  cy: number;
  progress: number;
  active: boolean;
}) {
  const r = 14;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * progress;
  return (
    <>
      <Circle cx={cx} cy={cy} r={r + 2} stroke="#0e1117" strokeOpacity={0.5} strokeWidth={1} fill="transparent" />
      <Circle cx={cx} cy={cy} r={r} stroke={active ? ACCENT_BRIGHT : ACCENT} strokeOpacity={0.35} strokeWidth={2} fill="transparent" />
      <Circle
        cx={cx}
        cy={cy}
        r={r}
        stroke={ACCENT_BRIGHT}
        strokeWidth={3}
        fill="transparent"
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={circumference / 4}
        strokeLinecap="round"
      />
      <Circle cx={cx} cy={cy} r={3} fill={active ? ACCENT_BRIGHT : '#fff'} />
    </>
  );
}

function projectQuad(q: Quad, frame: FrameSize, w: number, h: number): Quad {
  // Camera frame may be in landscape native orientation while the preview is
  // portrait; assume vision-camera has already rotated the frame to match the
  // displayed orientation, so we fit by aspect "cover" against the container.
  const frameAspect = frame.width / frame.height;
  const containerAspect = w / h;

  let scale: number;
  let dx = 0;
  let dy = 0;
  if (frameAspect > containerAspect) {
    // Frame wider than container -> letterbox horizontally (overflow cut).
    scale = h / frame.height;
    dx = (w - frame.width * scale) / 2;
  } else {
    scale = w / frame.width;
    dy = (h - frame.height * scale) / 2;
  }

  return [
    { x: q[0].x * scale + dx, y: q[0].y * scale + dy },
    { x: q[1].x * scale + dx, y: q[1].y * scale + dy },
    { x: q[2].x * scale + dx, y: q[2].y * scale + dy },
    { x: q[3].x * scale + dx, y: q[3].y * scale + dy },
  ];
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
