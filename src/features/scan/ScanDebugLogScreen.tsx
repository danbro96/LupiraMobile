import { useMemo, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { toast, toastError } from '../../feedback/toast';
import { cardSurface, radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';
import {
  type DecisionLogEntry,
  type DecisionReason,
  useDecisionLog,
} from './decisionLogStore';

/**
 * Decision-log viewer over the in-memory ring buffer from `useDecisionLog`: newest first, one row per state
 * transition, tap to expand the full signal dump. Share pipes the entries through React Native's Share so the
 * JSON can be pasted straight into a debugging conversation.
 *
 * Memory only, lost on restart — intentional: this is for diagnosing *the current session*. Sentry breadcrumbs
 * cover cross-session forensics for `fired` and `worklet_error`.
 */
export function ScanDebugLogScreen() {
  const entries = useDecisionLog((s) => s.entries);
  const clear = useDecisionLog((s) => s.clear);
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const empty = entries.length === 0;

  const onShare = async () => {
    if (empty) {
      toast('Nothing to share — the decision log is empty.');
      return;
    }
    try {
      await Share.share({ message: JSON.stringify(entries, null, 2) });
    } catch (e: unknown) {
      toastError(`Share failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Render newest-first without mutating the underlying array.
  const reversed = useMemo(() => [...entries].reverse(), [entries]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.toolbar}>
        <Text variant="bodySmall" style={styles.toolbarText}>{entries.length} entries</Text>
        <View style={styles.toolbarActions}>
          <Button
            icon={ICONS.delete}
            compact
            onPress={clear}
            disabled={empty}
            textColor={c.danger}
          >
            Clear
          </Button>
          <Button icon={ICONS.share} compact onPress={() => void onShare()} disabled={empty}>
            Share JSON
          </Button>
        </View>
      </View>

      {empty ? (
        <View style={styles.empty}>
          <MaterialIcons name={ICONS.log} size={36} color={c.textDisabled} />
          <Text variant="titleMedium">No decisions logged yet</Text>
          <Text variant="bodySmall" style={styles.emptyBody}>
            Open the Scan tab and aim at a card. Every state transition (blocked, progressing, fired, etc.) is recorded here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={reversed}
          keyExtractor={(item) => `${item.ts}-${item.framesProcessed}`}
          renderItem={({ item }) => <Row entry={item} c={c} styles={styles} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator
        />
      )}
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Row({ entry, c, styles }: { entry: DecisionLogEntry; c: Palette; styles: Styles }) {
  const [expanded, setExpanded] = useState(false);
  const { tint, label } = renderReason(entry.reason, c);
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
        <Text variant="bodyMedium" numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowMeta}>
          {hh}:{mm}:{ss}.{ms} · score {entry.composite.toFixed(2)} · fps {entry.detectionFps.toFixed(1)}
        </Text>
        {expanded ? (
          <View style={styles.rowExpanded}>
            <DataLine styles={styles} label="stab" value={entry.stability.toFixed(3)} />
            <DataLine styles={styles} label="sharp" value={entry.sharpness.toFixed(3)} />
            <DataLine styles={styles} label="cover" value={entry.coverage.toFixed(3)} />
            <DataLine
              styles={styles}
              label="bright"
              value={`${Math.round(entry.brightness)} (fit ${entry.brightnessFit.toFixed(2)})`}
            />
            <DataLine styles={styles} label="band" value={entry.inHysteresis ? 'in' : 'out'} />
            <DataLine styles={styles} label="floors" value={entry.hardFloorPass ? 'pass' : 'FAIL'} />
            <DataLine styles={styles} label="cooldown" value={entry.cooldownActive ? 'BLOCK' : 'clear'} />
            <DataLine styles={styles} label="frames#" value={String(entry.framesProcessed)} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function DataLine({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.dataLine}>
      <Text style={styles.dataLineLabel}>{label}</Text>
      <Text style={styles.dataLineValue}>{value}</Text>
    </View>
  );
}

function renderReason(reason: DecisionReason, c: Palette): { tint: string; label: string } {
  switch (reason.kind) {
    case 'no-quad':
      return { tint: c.textSubtle, label: 'No card seen' };
    case 'blocked-floor':
      return {
        tint: c.warning,
        label: `${reason.floor} ${fmt(reason.value)} below floor ${fmt(reason.threshold)}`,
      };
    case 'cooldown':
      return {
        tint: c.warning,
        label: `Cooldown — ${(reason.msRemaining / 1000).toFixed(1)} s remaining`,
      };
    case 'below-band':
      return {
        tint: c.text,
        label: `Score ${reason.composite.toFixed(2)} below threshold ${reason.thresholdHigh.toFixed(2)}`,
      };
    case 'progressing':
      return { tint: c.success, label: 'In band — counting stable frames' };
    case 'fired':
      return {
        tint: c.success,
        label: `Fired @ centroid ${reason.quadCentroid.x.toFixed(0)}, ${reason.quadCentroid.y.toFixed(0)}`,
      };
  }
}

function fmt(n: number): string {
  if (Math.abs(n) >= 10) return Math.round(n).toString();
  return n.toFixed(2);
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    toolbarText: { color: c.textMuted, fontFamily: 'monospace' },
    toolbarActions: { flexDirection: 'row', gap: spacing.xs },

    list: { padding: spacing.md, gap: 6 },
    row: {
      ...cardSurface(c),
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
      borderRadius: radii.md,
    },
    rowChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radii.round,
      borderWidth: 1,
      minWidth: 72,
      alignItems: 'center',
    },
    rowChipText: { fontSize: 10, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 0.5 },
    rowMain: { flex: 1, gap: 2 },
    rowMeta: { color: c.textSubtle, fontSize: 11, fontFamily: 'monospace' },
    rowExpanded: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      gap: 2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
    },
    dataLine: { flexDirection: 'row', justifyContent: 'space-between' },
    dataLineLabel: { color: c.textSubtle, fontSize: 11, fontFamily: 'monospace' },
    dataLineValue: { color: c.text, fontSize: 11, fontFamily: 'monospace' },

    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xxl,
      gap: spacing.sm,
    },
    emptyBody: { color: c.textSubtle, textAlign: 'center', lineHeight: 18 },
  });
