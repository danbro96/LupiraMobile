import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../store/auth-store';
import type { RootStackParamList } from '../../navigation/types';
import { Icon } from '../../components/Icon';
import { colors, font, radius, spacing } from '../../components/theme';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAuth(s => s.user);
  const mtgApiUrl = useAuth(s => s.mtgApiUrl);

  const signOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in with Authentik again to get back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void useAuth.getState().clearSession() },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <Icon name="person" size={32} color="white" />
        </View>
        {user?.displayName ? <Text style={styles.name}>{user.displayName}</Text> : null}
        <Text style={styles.email}>{user?.sub ?? 'Not signed in'}</Text>
        {user?.isAdmin ? <Text style={styles.role}>Admin</Text> : null}
      </View>

      <Section title="Scanning">
        <NavRow
          label="Scan tuning"
          subtitle="Auto-capture threshold, score weights, JPEG quality, debug overlay."
          onPress={() => navigation.navigate('ScanSettings')}
        />
      </Section>

      <Section title="Developer">
        <NavRow
          label="Decision log"
          subtitle="Why auto-capture fired (or didn't) — last 200 transitions."
          onPress={() => navigation.navigate('ScanDebugLog')}
        />
        <View style={styles.infoRow}>
          <Text style={styles.label}>API</Text>
          <Text style={styles.mono} numberOfLines={1}>{mtgApiUrl}</Text>
        </View>
      </Section>

      <Pressable style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function NavRow({ label, subtitle, onPress }: { label: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.navRow}>
      <View style={styles.navRowText}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Icon name="chevron-forward" size={18} color="muted" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, gap: spacing.lg },
  identity: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  name: { color: colors.textPrimary, fontSize: font.heading, fontWeight: '700' },
  email: { color: colors.textMuted, fontSize: font.small },
  role: { color: colors.primaryBright, fontSize: font.small, fontWeight: '600' },
  section: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, gap: 6 },
  sectionTitle: {
    color: colors.textBody,
    fontSize: font.small,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionBody: { gap: 6 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  navRowText: { flex: 1, gap: 2 },
  label: { color: colors.textPrimary, fontSize: font.body },
  subtitle: { color: colors.textFaint, fontSize: font.small, lineHeight: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  mono: { flexShrink: 1, color: colors.textBody, fontFamily: 'monospace', fontSize: font.small },
  signOutButton: {
    borderColor: colors.destructive,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  signOutText: { color: colors.destructive, fontSize: font.body, fontWeight: '600' },
});
