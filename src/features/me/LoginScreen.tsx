import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../store/auth-store';
import { useAuthSession } from '../../auth/AuthProvider';

export function LoginScreen() {
  const mtgApiUrl = useAuth(s => s.mtgApiUrl);
  const setApiUrl = useAuth(s => s.setApiUrl);
  const { register, busy, error } = useAuthSession();

  const [apiInput, setApiInput] = useState(mtgApiUrl);
  const [displayName, setDisplayName] = useState('');
  const [savingApi, setSavingApi] = useState(false);

  const apiDirty = apiInput.trim() !== mtgApiUrl;

  const onSaveApi = async () => {
    const url = apiInput.trim();
    if (!url) {
      Alert.alert('API URL required.');
      return;
    }
    setSavingApi(true);
    try {
      await setApiUrl(url);
    } finally {
      setSavingApi(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Lupira MTG</Text>
        <Text style={styles.subtitle}>
          Tap below to get started — your device gets a private identity for your collections.
        </Text>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Display name (optional)</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
            placeholder="e.g. Daniel"
            placeholderTextColor="#6e7686"
            style={styles.input}
          />
          <Text style={styles.hint}>Only used to label this device. Editable later.</Text>
        </View>

        <Pressable
          onPress={() => register(displayName)}
          disabled={busy || apiDirty}
          style={[styles.primaryButton, (busy || apiDirty) && styles.disabled]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Get started</Text>}
        </Pressable>

        {apiDirty ? <Text style={styles.hint}>Save the API URL first, then tap Get started.</Text> : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.divider} />

        <Text style={styles.advancedTitle}>Advanced</Text>
        <View style={styles.formGroup}>
          <Text style={styles.label}>API base URL</Text>
          <TextInput
            value={apiInput}
            onChangeText={setApiInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://mtg.lupira.com"
            placeholderTextColor="#6e7686"
            style={styles.input}
          />
          <Text style={styles.hint}>Override for dev (e.g. http://192.168.x.x:8080).</Text>
        </View>

        <Pressable
          onPress={onSaveApi}
          disabled={!apiDirty || savingApi}
          style={[styles.secondaryButton, (!apiDirty || savingApi) && styles.disabled]}
        >
          {savingApi ? <ActivityIndicator /> : <Text style={styles.secondaryButtonText}>Save API URL</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  scroll: { padding: 24, gap: 16 },
  title: { color: '#f5f5f5', fontSize: 32, fontWeight: '700', marginTop: 32 },
  subtitle: { color: '#9aa3b2', fontSize: 16, marginBottom: 16 },
  formGroup: { gap: 6 },
  label: { color: '#cbd1da', fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: '#1a1f29',
    color: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2c3340',
  },
  hint: { color: '#6e7686', fontSize: 12 },
  primaryButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    borderColor: '#3b82f6',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#3b82f6', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  error: { color: '#f97373', fontSize: 14, marginTop: 8 },
  divider: { height: 1, backgroundColor: '#1a1f29', marginVertical: 16 },
  advancedTitle: { color: '#cbd1da', fontSize: 14, fontWeight: '700' },
});
