import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { darkColors as d } from '../../../ui/theme';
import {
  selectLatestDecision,
  useDecisionLog,
  type DecisionReason,
} from '../decisionLogStore';

/**
 * Always-on single-line "why is auto-capture blocked / what is it doing" status, pinned just above the
 * capture gallery so it is visible without opening the debug HUD. Reads `useDecisionLog`'s `latest`
 * selector, which only updates when a new transition is appended (de-duplicated upstream), so the
 * re-render rate is cheap.
 */
export function DecisionStatusPill() {
  const latest = useDecisionLog(selectLatestDecision);
  if (!latest) {
    return null;
  }

  const { tint, label } = renderReason(latest.reason);

  return (
    <View style={[styles.outer, { borderColor: tint }]} pointerEvents="none">
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function renderReason(reason: DecisionReason): { tint: string; label: string } {
  switch (reason.kind) {
    case 'no-quad':
      return { tint: d.textSubtle, label: 'No card seen' };
    case 'blocked-floor':
      return {
        tint: d.warning,
        label: `Blocked: ${reason.floor} ${fmt(reason.value)} / ${fmt(reason.threshold)}`,
      };
    case 'cooldown': {
      const seconds = (reason.msRemaining / 1000).toFixed(1);
      return { tint: d.warning, label: `Cooldown ${seconds}s` };
    }
    case 'below-band':
      return {
        tint: d.text,
        label: `Score ${reason.composite.toFixed(2)} / ${reason.thresholdHigh.toFixed(2)} — too low`,
      };
    case 'progressing':
      return {
        tint: d.success,
        label: 'Stable — capture imminent',
      };
    case 'fired':
      return {
        tint: d.success,
        label: 'Fired',
      };
  }
}

/**
 * Format a signal value or threshold. Brightness is in 0..255, everything
 * else is 0..1 — pick precision based on magnitude.
 */
function fmt(n: number): string {
  if (Math.abs(n) >= 10) return Math.round(n).toString();
  return n.toFixed(2);
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    bottom: 132,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(8,12,22,0.78)',
    maxWidth: '90%',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    color: d.text,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
});
