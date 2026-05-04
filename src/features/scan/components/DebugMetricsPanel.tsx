import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ISharedValue } from 'react-native-worklets-core';
import type { DetectionMetrics } from '../detection/useCardDetection';

type Props = {
  metrics: ISharedValue<DetectionMetrics>;
  stableFrames: ISharedValue<number>;
  threshold: number;
  minStableFrames: number;
};

/**
 * Live HUD over the camera preview. Pulls worklet shared values via a 4Hz
 * rAF tick — fast enough to feel live, slow enough not to thrash the bridge.
 */
export function DebugMetricsPanel({ metrics, stableFrames, threshold, minStableFrames }: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) & 0xffff), 250);
    return () => clearInterval(id);
  }, []);

  const m = metrics.value;
  const stable = stableFrames.value;
  const meets = m.score >= threshold;

  return (
    <View style={styles.wrap}>
      <Row label="score" value={fmt(m.score)} accent={meets ? '#22c55e' : '#cbd1da'} />
      <Row label="stab" value={fmt(m.stability)} />
      <Row label="sharp" value={fmt(m.sharpness)} />
      <Row label="cover" value={fmt(m.coverage)} />
      <Row label="thr" value={fmt(threshold)} />
      <Row
        label="frames"
        value={`${stable}/${minStableFrames}`}
        accent={stable > 0 ? '#22c55e' : '#cbd1da'}
      />
      <Row label="det fps" value={m.detectionFps.toFixed(1)} />
      <Row label="frame" value={`${m.frameSize.width}x${m.frameSize.height}`} />
      <Row label="quad" value={m.hasQuad ? 'yes' : 'no'} accent={m.hasQuad ? '#22c55e' : '#f97373'} />
    </View>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 60,
    left: 12,
    backgroundColor: 'rgba(8, 12, 22, 0.78)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 150,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  label: {
    color: '#6e7686',
    fontSize: 11,
    fontFamily: 'monospace',
    textTransform: 'lowercase',
  },
  value: {
    color: '#cbd1da',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
