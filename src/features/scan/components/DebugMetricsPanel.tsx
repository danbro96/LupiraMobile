import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { Synchronizable } from 'react-native-worklets';
import type { DetectionMetrics } from '../detection/useCardDetection';
import { darkColors as d } from '../../../ui/theme';
import { usePolledValue } from '../detection/usePolledValue';
import { fmtScore as fmt } from '../scanFormat';

type Props = {
  metrics: Synchronizable<DetectionMetrics>;
  stableFrames: Synchronizable<number>;
  threshold: number;
  minStableFrames: number;
  weightStability: number;
  weightSharpness: number;
  weightCoverage: number;
  autoCaptureEnabled: boolean;
};

/** Live HUD over the camera preview, sampled at 4 Hz — live enough without thrashing the bridge. */
export function DebugMetricsPanel({
  metrics,
  stableFrames,
  threshold,
  minStableFrames,
  weightStability,
  weightSharpness,
  weightCoverage,
  autoCaptureEnabled,
}: Props) {
  const m = usePolledValue(() => metrics.getDirty(), 250);
  const stable = stableFrames.getDirty();
  const meets = m.score >= threshold;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Section title="Score">
        <Row label="combined" value={fmt(m.score)} accent={meets ? d.success : d.text} />
        <Row label="stab" value={fmt(m.stability)} />
        <Row label="sharp" value={fmt(m.sharpness)} />
        <Row label="cover" value={fmt(m.coverage)} />
        <Row label="bright" value={`${Math.round(m.brightness)} (${fmt(m.brightnessFit)})`} />
        <Row label="thr" value={fmt(threshold)} />
        <Row
          label="frames"
          value={`${stable}/${minStableFrames}`}
          accent={stable > 0 ? d.success : d.text}
        />
      </Section>

      <Section title="Gate">
        <Row
          label="floors"
          value={m.hardFloorPass ? 'pass' : 'FAIL'}
          accent={m.hardFloorPass ? d.success : d.danger}
        />
        <Row
          label="band"
          value={m.inHysteresis ? 'in' : 'out'}
          accent={m.inHysteresis ? d.success : d.text}
        />
        <Row
          label="cooldown"
          value={m.cooldownActive ? 'BLOCK' : 'clear'}
          accent={m.cooldownActive ? d.warning : d.success}
        />
      </Section>

      <Section title="Tunables">
        <Row label="auto" value={autoCaptureEnabled ? 'on' : 'off'} accent={autoCaptureEnabled ? d.success : d.danger} />
        <Row label="w.stab" value={fmt(weightStability)} />
        <Row label="w.sharp" value={fmt(weightSharpness)} />
        <Row label="w.cover" value={fmt(weightCoverage)} />
        <Row label="min frm" value={String(minStableFrames)} />
      </Section>

      <Section title="Detection">
        <Row label="quad" value={m.hasQuad ? 'yes' : 'no'} accent={m.hasQuad ? d.success : d.danger} />
        <Row label="edges px" value={String(m.edgePixelCount)} />
        <Row label="contours" value={String(m.contourCount)} />
        <Row label="big" value={String(m.largeContourCount)} />
        <Row label="fill %" value={String(m.largestContourFillPct)} />
        <Row label="best asp" value={m.largestContourAspect ? m.largestContourAspect.toFixed(2) : '—'} />
        <Row label="candidates" value={String(m.candidateQuadCount)} />
        <Row label="clipped" value={String(m.clippedQuadCount)} />
        <Row label="hist" value={String(m.historyDepth)} />
        <Row label="det fps" value={m.detectionFps.toFixed(1)} />
      </Section>

      <Section title="Pipeline">
        <Row label="frames" value={String(m.framesProcessed)} />
        <Row label="buf bytes" value={String(m.lastBufferBytes)} />
        <Row
          label="last step"
          value={m.lastStep || '—'}
          accent={m.lastStep === 'done' ? d.success : m.lastStep === 'detection-disabled' ? d.text : d.warning}
          multiline
        />
        <Row
          label="error"
          value={m.lastError || '—'}
          accent={m.lastError ? d.danger : d.text}
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
    color: d.primary,
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
    color: d.textSubtle,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  value: {
    color: d.text,
    fontSize: 11,
    fontFamily: 'monospace',
    flexShrink: 1,
    textAlign: 'right',
  },
});
