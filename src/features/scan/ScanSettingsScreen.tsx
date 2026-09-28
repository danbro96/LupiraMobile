import React, { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { List, Switch, Text } from 'react-native-paper';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  SCAN_MIN_FRAMES_BOUNDS,
  SCAN_QUALITY_BOUNDS,
  SCAN_THRESHOLD_BOUNDS,
  useScanSettings,
} from '../../store/scan-settings-store';
import type { RootStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/ConfirmDialog';
import { spacing, useColors, type Palette } from '../../ui/theme';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ScanSettings'>;

export function ScanSettingsScreen() {
  const settings = useScanSettings();
  const navigation = useNavigation<Nav>();
  const confirm = useConfirm();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  useEffect(() => {
    if (!settings.loaded) void settings.load();
  }, [settings]);

  const onReset = async () => {
    const ok = await confirm({
      title: 'Reset to defaults?',
      message: 'This restores all scan tuning to defaults.',
      confirmLabel: 'Reset',
      destructive: true,
    });
    if (ok) await settings.resetToDefaults();
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <List.Subheader>Auto-capture</List.Subheader>
        <List.Item
          title="Auto-capture enabled"
          right={() => (
            <Switch
              value={settings.autoCaptureEnabled}
              onValueChange={(v) => void settings.setAutoCaptureEnabled(v)}
              accessibilityLabel="Auto-capture enabled"
            />
          )}
        />
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

        <List.Subheader>Score weights</List.Subheader>
        <SliderRow
          label="Stability"
          value={settings.weightStability}
          min={0}
          max={1}
          step={0.05}
          valueLabel={settings.weightStability.toFixed(2)}
          onChange={(v) =>
            void settings.setWeights(
              v,
              settings.weightSharpness,
              settings.weightCoverage,
              settings.weightBrightness,
            )
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
            void settings.setWeights(
              settings.weightStability,
              v,
              settings.weightCoverage,
              settings.weightBrightness,
            )
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
            void settings.setWeights(
              settings.weightStability,
              settings.weightSharpness,
              v,
              settings.weightBrightness,
            )
          }
        />
        <SliderRow
          label="Brightness"
          value={settings.weightBrightness}
          min={0}
          max={1}
          step={0.05}
          valueLabel={settings.weightBrightness.toFixed(2)}
          onChange={(v) =>
            void settings.setWeights(
              settings.weightStability,
              settings.weightSharpness,
              settings.weightCoverage,
              v,
            )
          }
        />
        <Helper>
          Per-signal contributions to the soft composite score. Each signal also has a hidden hard floor — if any single signal drops below its floor, the auto-capture timer resets regardless of these weights.
        </Helper>

        <List.Subheader>Output</List.Subheader>
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

        <List.Subheader>Debug</List.Subheader>
        <List.Item
          title="Show debug overlay"
          description="Live HUD with score, stability, sharpness, coverage, fps."
          descriptionNumberOfLines={2}
          right={() => (
            <Switch
              value={settings.showDebugOverlay}
              onValueChange={(v) => void settings.setShowDebugOverlay(v)}
              accessibilityLabel="Show debug overlay"
            />
          )}
        />
        <List.Item
          title="Decision log"
          description="Replay why auto-capture fired (or didn't) — last 200 transitions."
          descriptionNumberOfLines={2}
          onPress={() => navigation.navigate('ScanDebugLog')}
        />

        <View style={styles.action}>
          <Button title="Reset to defaults" variant="destructive" onPress={() => void onReset()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Helper({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <Text variant="bodySmall" style={[helperStyles.helper, { color: c.textSubtle }]}>
      {children}
    </Text>
  );
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
  const c = useColors();
  return (
    <View style={helperStyles.sliderWrap}>
      <View style={helperStyles.sliderLabelRow}>
        <Text variant="bodyLarge">{label}</Text>
        <Text variant="bodySmall" style={[helperStyles.valueLabel, { color: c.textMuted }]}>
          {valueLabel}
        </Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onSlidingComplete={onChange}
        minimumTrackTintColor={c.primary}
        maximumTrackTintColor={c.border}
        thumbTintColor={c.primary}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    scroll: { paddingBottom: spacing.xxl },
    action: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  });

const helperStyles = StyleSheet.create({
  helper: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  sliderWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  valueLabel: { fontFamily: 'monospace' },
});
