import React, { useEffect, useState } from 'react';
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
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../../store/auth-store';
import {
  OIDC_CLIENT_ID,
  OIDC_ISSUER,
  OIDC_REDIRECT_PATH,
  OIDC_SCHEME,
  OIDC_SCOPES,
} from '../../auth/oidcConfig';
import { decodeJwt, exchangeAuthCode } from '../../auth/oidc';
import { logAuth } from '../../auth/authDebug';

// Lets the auth redirect dismiss the in-app browser and resolve the pending session.
WebBrowser.maybeCompleteAuthSession();

const ADMIN_GROUPS = ['mtg-admins', 'platform-admins'];

function isAdminFromClaims(claims: Record<string, unknown>): boolean {
  const groups = claims.groups;
  return Array.isArray(groups) && groups.some(g => ADMIN_GROUPS.includes(String(g)));
}

export function LoginScreen() {
  const mtgApiUrl = useAuth(s => s.mtgApiUrl);
  const setApiUrl = useAuth(s => s.setApiUrl);

  const discovery = AuthSession.useAutoDiscovery(OIDC_ISSUER);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: OIDC_SCHEME, path: OIDC_REDIRECT_PATH });
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    { clientId: OIDC_CLIENT_ID, scopes: OIDC_SCOPES, redirectUri, usePKCE: true },
    discovery,
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiInput, setApiInput] = useState(mtgApiUrl);
  const [savingApi, setSavingApi] = useState(false);
  const apiDirty = apiInput.trim() !== mtgApiUrl;

  async function handleSignIn() {
    setError(null);
    logAuth('prompt:open');
    try {
      // createTask:false (Android) keeps the auth tab in the app's task so the redirect returns
      // into it — without this it lands in a separate task and resolves 'dismiss' (expo/expo#23781).
      const result = await promptAsync({ createTask: false });
      logAuth('prompt:result', result.type);
    } catch (e) {
      logAuth('prompt:throw', String(e));
    }
  }

  useEffect(() => {
    if (!response) return;
    logAuth('response', response.type);
    if (response.type === 'error') {
      setError(response.error?.description ?? 'Sign-in failed.');
      return;
    }
    if (response.type !== 'success') {
      setError(`Sign-in did not complete (${response.type}).`);
      return;
    }
    if (!discovery?.tokenEndpoint || !request) {
      logAuth('response:guard', `discovery=${!!discovery} request=${!!request}`);
      return;
    }
    const tokenEndpoint = discovery.tokenEndpoint;
    const code = response.params.code;

    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const token = await exchangeAuthCode({
          tokenEndpoint,
          code,
          redirectUri,
          codeVerifier: request.codeVerifier,
        });
        const claims = decodeJwt(token.idToken ?? token.accessToken);
        const sub =
          (claims.email as string) ?? (claims.preferred_username as string) ?? (claims.sub as string) ?? '';
        const displayName = (claims.name as string) ?? (claims.given_name as string) ?? undefined;
        await useAuth.getState().setSession(
          {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: Date.now() + (token.expiresIn ?? 3600) * 1000,
          },
          { sub, displayName, isAdmin: isAdminFromClaims(claims) },
        );
        logAuth('setSession', 'authed=true');
      } catch (e) {
        logAuth('exchange:error', e instanceof Error ? e.message : String(e));
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [response, discovery, request, redirectUri]);

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
        <Text style={styles.subtitle}>Sign in with your Lupira account to reach your collections.</Text>

        <Pressable
          onPress={() => void handleSignIn()}
          disabled={!request || busy || apiDirty}
          style={[styles.primaryButton, (!request || busy || apiDirty) && styles.disabled]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Sign in with Authentik</Text>
          )}
        </Pressable>

        {apiDirty ? <Text style={styles.hint}>Save the API URL first, then sign in.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable onPress={() => setShowAdvanced(v => !v)} style={styles.advancedToggle}>
          <Text style={styles.advancedTitle}>{showAdvanced ? 'Hide advanced' : 'Advanced'}</Text>
        </Pressable>

        {showAdvanced ? (
          <View style={styles.formGroup}>
            <Text style={styles.label}>API base URL</Text>
            <TextInput
              value={apiInput}
              onChangeText={setApiInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://mtg-api.lupira.com"
              placeholderTextColor="#6e7686"
              style={styles.input}
            />
            <Text style={styles.hint}>Override for dev (e.g. http://192.168.x.x:8080).</Text>
            <Pressable
              onPress={onSaveApi}
              disabled={!apiDirty || savingApi}
              style={[styles.secondaryButton, (!apiDirty || savingApi) && styles.disabled]}
            >
              {savingApi ? <ActivityIndicator /> : <Text style={styles.secondaryButtonText}>Save API URL</Text>}
            </Pressable>
            <Text style={styles.hint}>redirect: {redirectUri}</Text>
          </View>
        ) : null}
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
    marginTop: 4,
  },
  secondaryButtonText: { color: '#3b82f6', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  error: { color: '#f97373', fontSize: 14, marginTop: 8 },
  advancedToggle: { marginTop: 16, paddingVertical: 4 },
  advancedTitle: { color: '#cbd1da', fontSize: 14, fontWeight: '700' },
});
