import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
import { Button } from '../../ui/components/Button';
import { TextField } from '../../ui/components/TextField';
import { toastError } from '../../feedback/toast';
import { radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';

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
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

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
      toastError('API URL required.');
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
        <View style={styles.logo}>
          <MaterialIcons name={ICONS.layers} size={52} color={c.onPrimary} />
        </View>
        <Text variant="headlineSmall">Lupira MTG</Text>
        <Text style={styles.subtitle}>Sign in with your Lupira account to reach your collections.</Text>

        <Button
          title="Sign in with Authentik"
          onPress={() => void handleSignIn()}
          disabled={!request || apiDirty}
          loading={busy}
          style={styles.button}
          contentStyle={styles.buttonContent}
        />

        {apiDirty ? <Text style={styles.hint}>Save the API URL first, then sign in.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title={showAdvanced ? 'Hide advanced' : 'Advanced'}
          variant="text"
          onPress={() => setShowAdvanced(v => !v)}
          style={styles.advancedToggle}
        />

        {showAdvanced ? (
          <View style={styles.formGroup}>
            <TextField
              label="API base URL"
              value={apiInput}
              onChangeText={setApiInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://mtg-api.lupira.com"
              style={styles.input}
            />
            <Text style={styles.hint}>Override for dev (e.g. http://192.168.x.x:8080).</Text>
            <Button
              title="Save API URL"
              variant="secondary"
              onPress={() => void onSaveApi()}
              disabled={!apiDirty}
              loading={savingApi}
            />
            <Text style={styles.hint}>redirect: {redirectUri}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    logo: {
      width: 96,
      height: 96,
      borderRadius: radii.lg + 8,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xl,
    },
    subtitle: { marginTop: spacing.sm, marginBottom: 28, fontSize: 15, color: c.textMuted, textAlign: 'center' },
    button: { width: '100%', maxWidth: 360, borderRadius: radii.round },
    buttonContent: { paddingVertical: 8 },
    error: { marginTop: spacing.lg, color: c.danger, textAlign: 'center' },
    hint: { marginTop: spacing.md, fontSize: 11, color: c.textDisabled },
    advancedToggle: { marginTop: spacing.lg },
    formGroup: { width: '100%', maxWidth: 360, gap: spacing.sm },
    input: { flex: 0 },
  });
