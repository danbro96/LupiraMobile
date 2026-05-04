import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ISharedValue } from 'react-native-worklets-core';
import type { DetectionMetrics } from '../detection/useCardDetection';

type Props = {
  metrics: ISharedValue<DetectionMetrics>;
  stableFrames: ISharedValue<number>;
  threshold: number;
  minStableFrames: number;
  weightStability: number;
  weightSharpness: number;
  weightCoverage: number;
  autoCaptureEnabled: boolean;
  capturing: boolean;
  uploadStatus: 'idle' | 'pending' | 'success' | 'error';
};

/**
 * Live HUD over the camera preview. Pulls worklet shared values via a 4Hz
 * rAF tick — fast enough to feel live, slow enough not to thrash the bridge.
 */
export function DebugMetricsPanel({
  metrics,
  stableFrames,
  threshold,
  minStableFrames,
  weightStability,
  weightSharpness,
  weightCoverage,
  autoCaptureEnabled,
  capturing,
  uploadStatus,
}: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) & 0xffff), 250);
    return () => clearInterval(id);
  }, []);

  const m = metrics.value;
  const stable = stableFrames.value;
  const meets = m.score >= threshold;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Section title="Score">
        <Row label="combined" value={fmt(m.score)} accent={meets ? '#22c55e' : '#cbd1da'} />
        <Row label="stab" value={fmt(m.stability)} />
        <Row label="sharp" value={fmt(m.sharpness)} />
        <Row label="cover" value={fmt(m.coverage)} />
        <Row label="thr" value={fmt(threshold)} />
        <Row
          label="frames"
          value={`${stable}/${minStableFrames}`}
          accent={stable > 0 ? '#22c55e' : '#cbd1da'}
        />
      </Section>

      <Section title="Tunables">
        <Row label="auto" value={autoCaptureEnabled ? 'on' : 'off'} accent={autoCaptureEnabled ? '#22c55e' : '#f97373'} />
        <Row label="w.stab" value={fmt(weightStability)} />
        <Row label="w.sharp" value={fmt(weightSharpness)} />
        <Row label="w.cover" value={fmt(weightCoverage)} />
        <Row label="min frm" value={String(minStableFrames)} />
      </Section>

      <Section title="Detection">
        <Row label="quad" value={m.hasQuad ? 'yes' : 'no'} accent={m.hasQuad ? '#22c55e' : '#f97373'} />
        <Row label="edges px" value={String(m.edgePixelCount)} />
        <Row label="contours" value={String(m.contourCount)} />
        <Row label="big" value={String(m.largeContourCount)} />
        <Row label="fill %" value={String(m.bestApproxVertexCount)} />
        <Row label="best asp" value={m.bestApproxAspect ? m.bestApproxAspect.toFixed(2) : '—'} />
        <Row label="candidates" value={String(m.candidateQuadCount)} />
        <Row label="hist" value={String(m.historyDepth)} />
        <Row label="det fps" value={m.detectionFps.toFixed(1)} />
      </Section>

      <Section title="Pipeline">
        <Row label="frames" value={String(m.framesProcessed)} />
        <Row label="buf bytes" value={String(m.lastBufferBytes)} />
        <Row
          label="last step"
          value={m.lastStep || '—'}
          accent={m.lastStep === 'done' ? '#22c55e' : m.lastStep === 'detection-disabled' ? '#cbd1da' : '#f59e0b'}
          multiline
        />
        <Row
          label="error"
          value={m.lastError || '—'}
          accent={m.lastError ? '#f97373' : '#cbd1da'}
          multiline
        />
      </Section>

      <Section title="Frame">
        <Row label="size" value={`${m.frameSize.width}x${m.frameSize.height}`} />
        <Row label="format" value={m.pixelFormat} />
        <Row label="orient" value={m.orientation} />
        <Row label="mirrored" value={m.isMirrored ? 'yes' : 'no'} />
        <Row label="bpr" value={String(m.bytesPerRow)} />
        <Row label="planes" value={String(m.planesCount)} />
      </Section>

      <Section title="State">
        <Row
          label="capture"
          value={capturing ? 'shooting' : 'idle'}
          accent={capturing ? '#f59e0b' : '#cbd1da'}
        />
        <Row
          label="upload"
          value={uploadStatus}
          accent={
            uploadStatus === 'success'
              ? '#22c55e'
              : uploadStatus === 'error'
                ? '#f97373'
                : uploadStatus === 'pending'
                  ? '#f59e0b'
                  : '#cbd1da'
          }
        />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({
  label,
  value,
  accent,
  multiline,
}: {
  label: string;
  value: string;
  accent?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text
        style={[styles.value, accent ? { color: accent } : null]}
        numberOfLines={multiline ? 6 : 1}
      >
        {value}
      </Text>
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
    maxHeight: '70%',
    width: 175,
    backgroundColor: 'rgba(8, 12, 22, 0.82)',
    borderRadius: 8,
  },
  content: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  section: {
    gap: 1,
  },
  sectionTitle: {
    color: '#3b82f6',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 4,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  label: {
    color: '#6e7686',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  value: {
    color: '#cbd1da',
    fontSize: 11,
    fontFamily: 'monospace',
    flexShrink: 1,
    textAlign: 'right',
  },
});
