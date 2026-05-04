import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthSession } from '../../auth/AuthProvider';
import { useAuth } from '../../store/auth-store';

export function ProfileScreen() {
  const { user, signOut } = useAuthSession();
  const mtgApiUrl = useAuth(s => s.mtgApiUrl);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <Text style={styles.title}>Account</Text>
        {user ? (
          <View style={styles.card}>
            {user.displayName ? <Row label="Name" value={user.displayName} /> : null}
            <Row label="Subject" value={user.sub} mono />
          </View>
        ) : null}

        <Text style={styles.section}>Endpoint</Text>
        <View style={styles.card}>
          <Row label="API" value={mtgApiUrl} mono />
        </View>

        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>Heads up</Text>
          <Text style={styles.warningText}>
            This is a PoC using device-only identity. There is no account recovery — if you sign out
            or reinstall, your collections stay on the server but you cannot reach them anymore.
          </Text>
        </View>

        <Pressable onPress={signOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono ? styles.mono : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e1117' },
  body: { padding: 24, gap: 16 },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '700' },
  section: { color: '#cbd1da', fontSize: 14, fontWeight: '600', marginTop: 8 },
  card: { backgroundColor: '#1a1f29', borderRadius: 8, padding: 16, gap: 8 },
  row: { gap: 2 },
  rowLabel: { color: '#6e7686', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  rowValue: { color: '#f5f5f5', fontSize: 14 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  warningBox: {
    backgroundColor: '#1a1f29',
    borderRadius: 8,
    padding: 16,
    gap: 6,
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  warningTitle: { color: '#f59e0b', fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  warningText: { color: '#cbd1da', fontSize: 13, lineHeight: 18 },
  signOutButton: {
    marginTop: 24,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f97373',
  },
  signOutText: { color: '#f97373', fontWeight: '600' },
});
