import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { darkColors as d } from '../../../ui/theme';
import {
  selectLatestDecision,
  useDecisionLog,
  type DecisionReason,
} from '../decisionLogStore';
import { fmtSignal, reasonTint } from '../scanFormat';

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

  const tint = reasonTint(latest.reason, d);
  const label = reasonLabel(latest.reason);

  return (
    <View style={[styles.outer, { borderColor: tint }]} pointerEvents="none">
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function reasonLabel(reason: DecisionReason): string {
  switch (reason.kind) {
    case 'no-quad':
      return reason.clipped ? 'Card past guide edge — move back' : 'No card seen';
    case 'blocked-floor':
      return `Blocked: ${reason.floor} ${fmtSignal(reason.value)} / ${fmtSignal(reason.threshold)}`;
    case 'cooldown':
      return 'Captured — next card';
    case 'below-band':
      return `Score ${reason.composite.toFixed(2)} / ${reason.thresholdHigh.toFixed(2)} — too low`;
    case 'progressing':
      return 'Stable — capture imminent';
    case 'fired':
      return 'Fired';
  }
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
