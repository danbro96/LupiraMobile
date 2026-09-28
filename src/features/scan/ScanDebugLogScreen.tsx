import { useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Button, SegmentedButtons, Text } from 'react-native-paper';
import { Image } from 'expo-image';
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
import { type ScanTraceEvent, useScanTrace } from './scanTraceStore';
import { fmtSignal, reasonTint } from './scanFormat';
import { useScanSettings } from '../../store/scan-settings-store';

type Tab = 'pipeline' | 'decisions';

/**
 * Scan debug viewer over two in-memory ring buffers: the capture pipeline trace (`useScanTrace`: camera,
 * worklet, fire → crop → upload → result) and the auto-capture decision log (`useDecisionLog`). Newest first,
 * tap a row to expand. Share exports both plus the current tuning as one JSON blob.
 *
 * Memory only, lost on restart — intentional: this is for diagnosing *the current session*. Every trace event
 * is also a Sentry breadcrumb for cross-session forensics.
 */
export function ScanDebugLogScreen() {
  const entries = useDecisionLog((s) => s.entries);
  const clearDecisions = useDecisionLog((s) => s.clear);
  const events = useScanTrace((s) => s.events);
  const clearTrace = useScanTrace((s) => s.clear);
  const [tab, setTab] = useState<Tab>('pipeline');
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const empty = entries.length === 0 && events.length === 0;

  const onShare = async () => {
    if (empty) {
      toast('Nothing to share — the logs are empty.');
      return;
    }
    const settings = Object.fromEntries(
      Object.entries(useScanSettings.getState()).filter(([k, v]) => typeof v !== 'function' && k !== 'loaded'),
    );
    const payload = {
      exportedAt: new Date().toISOString(),
      platform: `${Platform.OS} ${Platform.Version}`,
      settings,
      pipeline: events,
      decisions: entries,
    };
    try {
      await Share.share({ message: JSON.stringify(payload, null, 2) });
    } catch (e: unknown) {
      toastError(`Share failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onClear = () => {
    clearDecisions();
    clearTrace();
  };

  // Render newest-first without mutating the underlying arrays.
  const reversedEntries = useMemo(() => [...entries].reverse(), [entries]);
  const reversedEvents = useMemo(() => [...events].reverse(), [events]);
  const tabEmpty = tab === 'pipeline' ? events.length === 0 : entries.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.toolbar}>
        <Text variant="bodySmall" style={styles.toolbarText}>
          {events.length} events · {entries.length} decisions
        </Text>
        <View style={styles.toolbarActions}>
          <Button
            icon={ICONS.delete}
            compact
            onPress={onClear}
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
      <SegmentedButtons
        style={styles.tabs}
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        buttons={[
          { value: 'pipeline', label: 'Pipeline' },
          { value: 'decisions', label: 'Decisions' },
        ]}
      />

      {tabEmpty ? (
        <View style={styles.empty}>
          <MaterialIcons name={ICONS.log} size={36} color={c.textDisabled} />
          <Text variant="titleMedium">Nothing logged yet</Text>
          <Text variant="bodySmall" style={styles.emptyBody}>
            {tab === 'pipeline'
              ? 'Open the Scan tab and scan a card. Camera, worklet, crop, upload and recognition events are recorded here.'
              : 'Open the Scan tab and aim at a card. Every state transition (blocked, progressing, fired, etc.) is recorded here.'}
          </Text>
        </View>
      ) : tab === 'pipeline' ? (
        <FlatList
          data={reversedEvents}
          keyExtractor={(item) => String(item.seq)}
          renderItem={({ item }) => <TraceRow event={item} c={c} styles={styles} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator
        />
      ) : (
        <FlatList
          data={reversedEntries}
          keyExtractor={(item) => `${item.ts}-${item.framesProcessed}`}
          renderItem={({ item }) => <Row entry={item} c={c} styles={styles} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator
        />
      )}
    </SafeAreaView>
  );
}

function TraceRow({ event, c, styles }: { event: ScanTraceEvent; c: Palette; styles: Styles }) {
  const [expanded, setExpanded] = useState(false);
  const tint =
    event.level === 'error' ? c.danger : event.level === 'warning' ? c.warning : event.level === 'debug' ? c.textSubtle : c.success;
  const cropUri = typeof event.data?.uri === 'string' ? event.data.uri : undefined;

  return (
    <Pressable onPress={() => setExpanded((v) => !v)} style={styles.row}>
      <View style={[styles.rowChip, { backgroundColor: tint + '22', borderColor: tint }]}>
        <Text style={[styles.rowChipText, { color: tint }]}>{event.kind}</Text>
      </View>
      <View style={styles.rowMain}>
        <Text variant="bodyMedium" numberOfLines={expanded ? undefined : 1}>
          {event.message}
        </Text>
        <Text style={styles.rowMeta}>
          {formatTime(event.ts)}{event.captureId ? ` · ${event.captureId}` : ''}
        </Text>
        {expanded ? (
          <View style={styles.rowExpanded}>
            {cropUri ? <Image source={{ uri: cropUri }} style={styles.cropThumb} contentFit="contain" /> : null}
            {event.data ? (
              <Text style={styles.dataLineValue} selectable>
                {JSON.stringify(event.data, null, 2)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function formatTime(ts: number): string {
  const time = new Date(ts);
  const hh = time.getHours().toString().padStart(2, '0');
  const mm = time.getMinutes().toString().padStart(2, '0');
  const ss = time.getSeconds().toString().padStart(2, '0');
  const ms = time.getMilliseconds().toString().padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

type Styles = ReturnType<typeof makeStyles>;

function Row({ entry, c, styles }: { entry: DecisionLogEntry; c: Palette; styles: Styles }) {
  const [expanded, setExpanded] = useState(false);
  const tint = reasonTint(entry.reason, c);
  const label = reasonLabel(entry.reason);

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
          {formatTime(entry.ts)} · score {entry.composite.toFixed(2)} · fps {entry.detectionFps.toFixed(1)}
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
            <DataLine styles={styles} label="edges" value={String(entry.edgePixelCount)} />
            <DataLine
              styles={styles}
              label="contours"
              value={`${entry.contourCount} (large ${entry.largeContourCount}, quads ${entry.candidateQuadCount}, clipped ${entry.clippedQuadCount})`}
            />
            <DataLine
              styles={styles}
              label="largest"
              value={`fill ${entry.largestContourFillPct}% · aspect ${entry.largestContourAspect.toFixed(2)}`}
            />
            <DataLine styles={styles} label="step" value={entry.lastStep} />
            {entry.lastError ? <DataLine styles={styles} label="error" value={entry.lastError} /> : null}
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

function reasonLabel(reason: DecisionReason): string {
  switch (reason.kind) {
    case 'no-quad':
      return reason.clipped ? 'Card-shaped contour clipped by guide edge' : 'No card seen';
    case 'blocked-floor':
      return `${reason.floor} ${fmtSignal(reason.value)} below floor ${fmtSignal(reason.threshold)}`;
    case 'cooldown':
      return `Cooldown — ${(reason.msRemaining / 1000).toFixed(1)} s remaining`;
    case 'below-band':
      return `Score ${reason.composite.toFixed(2)} below threshold ${reason.thresholdHigh.toFixed(2)}`;
    case 'progressing':
      return `In band — stable ${reason.stableFrames}/${reason.minStableFrames}`;
    case 'fired':
      return `Fired @ centroid ${reason.quadCentroid.x.toFixed(0)}, ${reason.quadCentroid.y.toFixed(0)}`;
  }
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
    tabs: { marginHorizontal: spacing.lg, marginTop: spacing.sm },
    cropThumb: { width: 120, height: 168, borderRadius: radii.sm, marginBottom: spacing.sm },

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
