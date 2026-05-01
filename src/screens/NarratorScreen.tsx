import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScriptEditor } from '../components/ScriptEditor';
import { SettingsForm } from '../components/SettingsForm';
import { SpeedPicker } from '../components/SpeedPicker';
import { VoicePicker } from '../components/VoicePicker';
import { useNarrator } from '../hooks/use-narrator';
import { useSettings } from '../store/settings-store';

export function NarratorScreen() {
  const settings = useSettings();
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!settings.loaded) settings.load();
  }, [settings]);

  const credentialsReady = settings.loaded && settings.hasCredentials();

  const narrator = useNarrator({
    apiUrl: credentialsReady ? settings.apiUrl : '',
    apiKey: credentialsReady ? settings.apiKey : '',
    voice: settings.voice,
    speed: settings.speed,
  });

  if (!settings.loaded) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.muted}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!credentialsReady || showSettings) {
    return (
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <SettingsForm
            initialApiUrl={settings.apiUrl}
            initialApiKey={settings.apiKey}
            onSave={async (apiUrl, apiKey) => {
              await settings.setCredentials(apiUrl, apiKey);
              setShowSettings(false);
            }}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const handleChange = (next: string) => {
    narrator.acceptInput(next);
  };

  const handleClear = () => {
    narrator.cancel();
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Lupira Narrator</Text>
          <Pressable onPress={() => setShowSettings(true)}>
            <Text style={styles.headerLink}>Settings</Text>
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.dot, dotStyle(narrator.status)]} />
          <Text style={styles.statusText}>{statusLabel(narrator)}</Text>
        </View>

        <View style={styles.controls}>
          <VoicePicker
            apiUrl={settings.apiUrl}
            apiKey={settings.apiKey}
            selected={settings.voice}
            onSelect={(v) => settings.setVoice(v)}
          />
          <SpeedPicker value={settings.speed} onChange={(s) => settings.setSpeed(s)} />
        </View>

        <View style={styles.editorWrap}>
          <ScriptEditor
            value={narrator.editorBuffer}
            onChange={handleChange}
            editable={narrator.status !== 'error'}
          />
        </View>

        <View style={styles.actions}>
          <Pressable style={[styles.button, styles.secondary]} onPress={handleClear}>
            <Text style={styles.secondaryText}>Stop &amp; clear</Text>
          </Pressable>
          <Pressable
            style={[
              styles.button,
              styles.primary,
              !narrator.editorBuffer && styles.buttonDisabled,
            ]}
            onPress={() => narrator.speakRest()}
            disabled={!narrator.editorBuffer}
          >
            <Text style={styles.primaryText}>Speak rest</Text>
          </Pressable>
        </View>

        {narrator.errorMessage ? (
          <Text style={styles.error}>⚠︎ {narrator.errorMessage}</Text>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function statusLabel(n: ReturnType<typeof useNarrator>): string {
  if (n.errorMessage && n.status === 'error') return `Error: ${n.errorMessage}`;
  if (n.status === 'connecting') return 'Connecting…';
  if (n.status === 'closed') return 'Disconnected';
  if (n.status === 'idle') return 'Idle';
  if (n.isSpeaking)
    return n.currentSegmentText ? `Speaking: ${n.currentSegmentText}` : 'Speaking…';
  return 'Ready';
}

function dotStyle(status: string) {
  if (status === 'ready') return { backgroundColor: '#34c759' };
  if (status === 'connecting') return { backgroundColor: '#ff9f0a' };
  if (status === 'error' || status === 'closed') return { backgroundColor: '#ff3b30' };
  return { backgroundColor: '#8e8e93' };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  fill: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#888' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  title: { fontSize: 22, fontWeight: '700' },
  headerLink: { color: '#0a84ff', fontSize: 15, fontWeight: '500' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 13, color: '#444', flex: 1 },
  controls: {
    paddingHorizontal: 20,
    gap: 10,
  },
  editorWrap: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primary: { backgroundColor: '#0a84ff' },
  secondary: { backgroundColor: '#f5f5f7', borderWidth: 1, borderColor: '#e0e0e0' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryText: { color: '#111', fontSize: 16, fontWeight: '500' },
  buttonDisabled: { opacity: 0.4 },
  error: {
    color: '#b00020',
    paddingHorizontal: 20,
    paddingBottom: 12,
    fontSize: 13,
  },
});
