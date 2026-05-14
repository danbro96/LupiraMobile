import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import {
  type DecisionLogEntry,
  type DecisionReason,
  useDecisionLog,
} from './decisionLogStore';

/**
 * Decision-log viewer. Renders the in-memory ring buffer from
 * `useDecisionLog` newest-first, with one row per state transition. Tap a
 * row to expand the full signal dump for that moment. Top bar exposes Clear
 * and Share — the latter pipes the entries through React Native's built-in
 * Share so you can paste the JSON into Slack / a debugging conversation
 * without retyping anything.
 *
 * Memory only — entries are lost on app restart. That's intentional: the
 * log is for diagnosing *the current session's* misbehaviour. Sentry
 * breadcrumbs cover cross-session forensics for `fired` and `worklet_error`.
 */
export function ScanDebugLogScreen() {
  const entries = useDecisionLog((s) => s.entries);
  const clear = useDecisionLog((s) => s.clear);

  const onShare = async () => {
    if (entries.length === 0) {
      Alert.alert('Nothing to share', 'The decision log is empty.');
      return;
    }
    try {
      await Share.share({ message: JSON.stringify(entries, null, 2) });
    } catch (e: unknown) {
      Alert.alert('Share failed', e instanceof Error ? e.message : String(e));
    }
  };

  // Render newest-first without mutating the underlying array.
  const reversed = React.useMemo(() => [...entries].reverse(), [entries]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarText}>{entries.length} entries</Text>
        <View style={styles.toolbarActions}>
          <Pressable
            onPress={clear}
            disabled={entries.length === 0}
            style={[styles.toolbarButton, entries.length === 0 && styles.toolbarButtonDisabled]}
          >
            <Icon
              name="trash-outline"
              size={16}
              color={entries.length === 0 ? 'muted' : 'destructive'}
            />
            <Text
              style={[
                styles.toolbarButtonText,
                { color: entries.length === 0 ? '#6e7686' : '#f97373' },
              ]}
            >
              Clear
            </Text>
          </Pressable>
          <Pressable
            onPress={onShare}
            disabled={entries.length === 0}
            style={[styles.toolbarButton, entries.length === 0 && styles.toolbarButtonDisabled]}
          >
            <Icon
              name="share-outline"
              size={16}
              color={entries.length === 0 ? 'muted' : 'primary'}
            />
            <Text
              style={[
                styles.toolbarButtonText,
                { color: entries.length === 0 ? '#6e7686' : '#3b82f6' },
              ]}
            >
              Share JSON
            </Text>
          </Pressable>
        </View>
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="document-text-outline" size={36} tint="rgba(255,255,255,0.25)" />
          <Text style={styles.emptyTitle}>No decisions logged yet</Text>
          <Text style={styles.emptyBody}>
            Open the Scan tab and aim at a card. Every state transition (blocked, progressing, fired, etc.) is recorded here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={reversed}
          keyExtractor={(item) => `${item.ts}-${item.framesProcessed}`}
          renderItem={({ item }) => <Row entry={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator
        />
      )}
    </SafeAreaView>
  );
}

function Row({ entry }: { entry: DecisionLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { tint, label } = renderReason(entry.reason);
  const time = new Date(entry.ts);
  const hh = time.getHours().toString().padStart(2, '0');
  const mm = time.getMinutes().toString().padStart(2, '0');
  const ss = time.getSeconds().toString().padStart(2, '0');
  const ms = time.getMilliseconds().toString().padStart(3, '0');

  return (
    <Pressable onPress={() => setExpanded((v) => !v)} style={styles.row}>
      <View style={[styles.rowChip, { backgroundColor: tint + '22', borderColor: tint }]}>
        <Text style={[styles.rowChipText, { color: tint }]}>{entry.reason.kind}</Text>
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowMeta}>
          {hh}:{mm}:{ss}.{ms} · score {entry.composite.toFixed(2)} · fps {entry.detectionFps.toFixed(1)}
        </Text>
        {expanded ? (
          <View style={styles.rowExpanded}>
            <DataLine label="stab" value={entry.stability.toFixed(3)} />
            <DataLine label="sharp" value={entry.sharpness.toFixed(3)} />
            <DataLine label="cover" value={entry.coverage.toFixed(3)} />
            <DataLine
              label="bright"
              value={`${Math.round(entry.brightness)} (fit ${entry.brightnessFit.toFixed(2)})`}
            />
            <DataLine label="band" value={entry.inHysteresis ? 'in' : 'out'} />
            <DataLine label="floors" value={entry.hardFloorPass ? 'pass' : 'FAIL'} />
            <DataLine label="cooldown" value={entry.cooldownActive ? 'BLOCK' : 'clear'} />
            <DataLine label="frames#" value={String(entry.framesProcessed)} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dataLine}>
      <Text style={styles.dataLineLabel}>{label}</Text>
      <Text style={styles.dataLineValue}>{value}</Text>
    </View>
  );
}

function renderReason(reason: DecisionReason): { tint: string; label: string } {
  switch (reason.kind) {
    case 'no-quad':
      return { tint: '#6e7686', label: 'No card seen' };
    case 'blocked-floor':
      return {
        tint: '#f59e0b',
        label: `${reason.floor} ${fmt(reason.value)} below floor ${fmt(reason.threshold)}`,
      };
    case 'cooldown':
      return {
        tint: '#f59e0b',
        label: `Cooldown — ${(reason.msRemaining / 1000).toFixed(1)} s remaining`,
      };
    case 'below-band':
      return {
        tint: '#cbd1da',
        label: `Score ${reason.composite.toFixed(2)} below threshold ${reason.thresholdHigh.toFixed(2)}`,
      };
    case 'progressing':
      return { tint: '#22c55e', label: 'In band — counting stable frames' };
    case 'fired':
      return {
        tint: '#22c55e',
        label: `Fired @ centroid ${reason.quadCentroid.x.toFixed(0)}, ${reason.quadCentroid.y.toFixed(0)}`,
      };
  }
}

function fmt(n: number): string {
  if (Math.abs(n) >= 10) return Math.round(n).toString();
  return n.toFixed(2);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1f29',
  },
  toolbarText: { color: '#9aa3b2', fontSize: 13, fontFamily: 'monospace' },
  toolbarActions: { flexDirection: 'row', gap: 12 },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1a1f29',
  },
  toolbarButtonDisabled: { opacity: 0.5 },
  toolbarButtonText: { fontSize: 13, fontWeight: '600' },

  list: { paddingHorizontal: 12, paddingVertical: 12, gap: 6 },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#1a1f29',
    borderRadius: 8,
    padding: 10,
  },
  rowChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 72,
    alignItems: 'center',
  },
  rowChipText: { fontSize: 10, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 0.5 },
  rowMain: { flex: 1, gap: 2 },
  rowLabel: { color: '#f5f5f5', fontSize: 13 },
  rowMeta: { color: '#6e7686', fontSize: 11, fontFamily: 'monospace' },
  rowExpanded: {
    marginTop: 8,
    paddingTop: 8,
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: '#0e1117',
  },
  dataLine: { flexDirection: 'row', justifyContent: 'space-between' },
  dataLineLabel: { color: '#6e7686', fontSize: 11, fontFamily: 'monospace' },
  dataLineValue: { color: '#cbd1da', fontSize: 11, fontFamily: 'monospace' },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emptyTitle: { color: '#cbd1da', fontSize: 16, fontWeight: '600' },
  emptyBody: { color: '#6e7686', fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
