import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { darkColors as d } from '../../../ui/theme';
import { HARD_FLOORS } from '../detection/useCardDetection';
import {
  selectLatestDecision,
  useDecisionLog,
  type DecisionReason,
} from '../decisionLogStore';
import { fmtSignal, reasonTint } from '../scanFormat';

/**
 * Always-on single-line coaching ("Move closer", "Hold steady") pinned above the capture gallery; with
 * `showDebug` it shows the raw gate values instead. Reads `useDecisionLog`'s `latest` selector, which only
 * updates when a new transition is appended (de-duplicated upstream), so the re-render rate is cheap.
 */
export function DecisionStatusPill({ showDebug }: { showDebug: boolean }) {
  const latest = useDecisionLog(selectLatestDecision);
  if (!latest) {
    return null;
  }

  const tint = reasonTint(latest.reason, d);
  const label = showDebug ? debugLabel(latest.reason) : coachingLabel(latest.reason);

  return (
    <View style={[styles.outer, { borderColor: tint }]} pointerEvents="none">
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Text style={[styles.text, showDebug && styles.debugText]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function coachingLabel(reason: DecisionReason): string {
  switch (reason.kind) {
    case 'no-quad':
      return reason.clipped ? 'Move the card back inside the frame' : 'Place a card inside the frame';
    case 'blocked-floor':
      return floorHint(reason);
    case 'cooldown':
      return 'Got it — next card';
    case 'below-band':
      return 'Line the card up with the frame';
    case 'progressing':
      return 'Hold still…';
    case 'fired':
      return 'Captured';
  }
}

function floorHint(reason: Extract<DecisionReason, { kind: 'blocked-floor' }>): string {
  switch (reason.floor) {
    case 'coverage':
      return 'Move closer';
    case 'stability':
      return 'Hold steady';
    case 'sharpness':
      return 'Hold steady — focusing';
    case 'brightness':
      return reason.value > HARD_FLOORS.brightnessMax ? 'Too bright — tilt away from glare' : 'Too dark — add light';
  }
}

function debugLabel(reason: DecisionReason): string {
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
    // Above ScanScreen's action bar (bottom 128, ~44 px tall).
    bottom: 184,
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
    fontSize: 13,
    fontWeight: '600',
  },
  debugText: { fontSize: 12, fontFamily: 'monospace' },
});
