import React, { useEffect } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  SCAN_MIN_FRAMES_BOUNDS,
  SCAN_QUALITY_BOUNDS,
  SCAN_THRESHOLD_BOUNDS,
  useScanSettings,
} from '../../store/scan-settings-store';

export function ScanSettingsScreen() {
  const settings = useScanSettings();

  useEffect(() => {
    if (!settings.loaded) void settings.load();
  }, [settings]);

  const onReset = async () => {
    Alert.alert('Reset to defaults?', 'This restores all scan tuning to defaults.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => void settings.resetToDefaults() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title="Auto-capture">
          <Row>
            <Text style={styles.label}>Auto-capture enabled</Text>
            <Switch
              value={settings.autoCaptureEnabled}
              onValueChange={(v) => void settings.setAutoCaptureEnabled(v)}
              trackColor={{ true: '#3b82f6', false: '#2c3340' }}
            />
          </Row>
          <SliderRow
            label="Capture threshold"
            value={settings.captureThreshold}
            min={SCAN_THRESHOLD_BOUNDS.min}
            max={SCAN_THRESHOLD_BOUNDS.max}
            step={0.05}
            valueLabel={settings.captureThreshold.toFixed(2)}
            onChange={(v) => void settings.setCaptureThreshold(v)}
          />
          <Helper>
            Combined detection score (0–1) the camera must hit to start the
            stable-frame countdown.
          </Helper>
          <SliderRow
            label="Min stable frames"
            value={settings.minStableFrames}
            min={SCAN_MIN_FRAMES_BOUNDS.min}
            max={SCAN_MIN_FRAMES_BOUNDS.max}
            step={1}
            valueLabel={String(settings.minStableFrames)}
            onChange={(v) => void settings.setMinStableFrames(v)}
          />
          <Helper>How long the score has to hold before auto-capture fires.</Helper>
        </Section>

        <Section title="Score weights">
          <SliderRow
            label="Stability"
            value={settings.weightStability}
            min={0}
            max={1}
            step={0.05}
            valueLabel={settings.weightStability.toFixed(2)}
            onChange={(v) =>
              void settings.setWeights(v, settings.weightSharpness, settings.weightCoverage)
            }
          />
          <SliderRow
            label="Sharpness"
            value={settings.weightSharpness}
            min={0}
            max={1}
            step={0.05}
            valueLabel={settings.weightSharpness.toFixed(2)}
            onChange={(v) =>
              void settings.setWeights(settings.weightStability, v, settings.weightCoverage)
            }
          />
          <SliderRow
            label="Coverage"
            value={settings.weightCoverage}
            min={0}
            max={1}
            step={0.05}
            valueLabel={settings.weightCoverage.toFixed(2)}
            onChange={(v) =>
              void settings.setWeights(settings.weightStability, settings.weightSharpness, v)
            }
          />
          <Helper>Weights do not have to sum to 1; the combined score is rescaled by usage.</Helper>
        </Section>

        <Section title="Output">
          <SliderRow
            label="JPEG quality"
            value={settings.jpegQuality}
            min={SCAN_QUALITY_BOUNDS.min}
            max={SCAN_QUALITY_BOUNDS.max}
            step={5}
            valueLabel={`${settings.jpegQuality}%`}
            onChange={(v) => void settings.setJpegQuality(v)}
          />
          <Helper>Used when re-encoding the perspective-corrected card before upload.</Helper>
        </Section>

        <Section title="Debug">
          <Row>
            <Text style={styles.label}>Show debug overlay</Text>
            <Switch
              value={settings.showDebugOverlay}
              onValueChange={(v) => void settings.setShowDebugOverlay(v)}
              trackColor={{ true: '#3b82f6', false: '#2c3340' }}
            />
          </Row>
          <Helper>Live HUD with score, stability, sharpness, coverage, fps.</Helper>

          <Row>
            <Text style={styles.label}>Preview before upload</Text>
            <Switch
              value={settings.previewBeforeUpload}
              onValueChange={(v) => void settings.setPreviewBeforeUpload(v)}
              trackColor={{ true: '#3b82f6', false: '#2c3340' }}
            />
          </Row>
          <Helper>
            When on, every capture stops at a preview screen with Send / Retake before reaching the backend.
          </Helper>
        </Section>

        <Pressable style={styles.resetButton} onPress={onReset}>
          <Text style={styles.resetText}>Reset to defaults</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Helper({ children }: { children: React.ReactNode }) {
  return <Text style={styles.helper}>{children}</Text>;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  valueLabel,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueLabel: string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.sliderWrap}>
      <View style={styles.sliderLabelRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.valueLabel}>{valueLabel}</Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onSlidingComplete={onChange}
        minimumTrackTintColor="#3b82f6"
        maximumTrackTintColor="#2c3340"
        thumbTintColor="#3b82f6"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  scroll: { padding: 16, gap: 16 },
  section: {
    backgroundColor: '#1a1f29',
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  sectionTitle: {
    color: '#cbd1da',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionBody: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  label: { color: '#f5f5f5', fontSize: 14 },
  helper: { color: '#6e7686', fontSize: 12, lineHeight: 16 },
  sliderWrap: { paddingTop: 6 },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  valueLabel: { color: '#cbd1da', fontSize: 13, fontFamily: 'monospace' },
  resetButton: {
    borderColor: '#f97373',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  resetText: { color: '#f97373', fontSize: 14, fontWeight: '600' },
});
