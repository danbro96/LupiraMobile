import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { List, Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../store/auth-store';
import type { RootStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/ConfirmDialog';
import { radii, spacing, useColors, type Palette } from '../../ui/theme';
import { ICONS } from '../../ui/icons';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAuth(s => s.user);
  const mtgApiUrl = useAuth(s => s.mtgApiUrl);
  const confirm = useConfirm();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);

  async function signOut() {
    const ok = await confirm({
      title: 'Sign out?',
      message: 'You will need to sign in with Authentik again to get back in.',
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (ok) await useAuth.getState().clearSession();
  }

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <MaterialIcons name={ICONS.account} size={32} color={c.onPrimary} />
        </View>
        {user?.displayName ? <Text variant="titleLarge">{user.displayName}</Text> : null}
        <Text variant="bodySmall" style={styles.email}>{user?.sub ?? 'Not signed in'}</Text>
        {user?.isAdmin ? <Text variant="labelMedium" style={styles.role}>Admin</Text> : null}
      </View>

      <List.Subheader>Account</List.Subheader>
      <View style={styles.action}>
        <Button title="Sign out" variant="destructive" onPress={() => void signOut()} />
      </View>

      <List.Subheader>Scanning</List.Subheader>
      <List.Item
        title="Scan tuning"
        description="Auto-capture threshold, score weights, JPEG quality, debug overlay."
        descriptionNumberOfLines={3}
        onPress={() => navigation.navigate('ScanSettings')}
      />

      <List.Subheader>Developer</List.Subheader>
      <List.Item
        title="Decision log"
        description="Why auto-capture fired (or didn't) — last 200 transitions."
        descriptionNumberOfLines={3}
        onPress={() => navigation.navigate('ScanDebugLog')}
      />
      <List.Item
        title="API"
        description={mtgApiUrl}
        descriptionStyle={styles.mono}
      />
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fill: { flex: 1, backgroundColor: c.bg },
    content: { paddingBottom: spacing.xxl },
    identity: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.lg },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: radii.round,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    email: { color: c.textMuted },
    role: { color: c.primary, marginTop: spacing.xs },
    action: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    mono: { fontFamily: 'monospace' },
  });
