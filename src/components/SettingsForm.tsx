import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DEFAULT_API_URL } from '../config';

type Props = {
  initialApiUrl: string;
  initialApiKey: string;
  onSave: (apiUrl: string, apiKey: string) => Promise<void>;
};

export function SettingsForm({ initialApiUrl, initialApiKey, onSave }: Props) {
  const [apiUrl, setApiUrl] = useState(initialApiUrl || DEFAULT_API_URL);
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const url = apiUrl.trim();
    const key = apiKey.trim();
    if (!url || !key) {
      Alert.alert('Missing fields', 'Both API URL and API key are required.');
      return;
    }
    setSaving(true);
    try {
      await onSave(url, key);
    } catch (e) {
      Alert.alert('Save failed', String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Connect to Kokoro</Text>
      <Text style={styles.helper}>
        Paste your WebSocket URL and API key. They&apos;re stored in the device&apos;s
        secure keystore.
      </Text>

      <Text style={styles.label}>WebSocket URL</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={DEFAULT_API_URL}
        value={apiUrl}
        onChangeText={setApiUrl}
      />

      <Text style={styles.label}>API key</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="64-hex-char key"
        value={apiKey}
        onChangeText={setApiKey}
      />

      <Pressable
        style={[styles.button, saving && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save & connect'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 20,
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  helper: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    color: '#666',
    marginTop: 12,
  },
  input: {
    fontSize: 15,
    padding: 12,
    backgroundColor: '#f5f5f7',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    color: '#111',
  },
  button: {
    marginTop: 24,
    backgroundColor: '#0a84ff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
