import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../store/auth-store';

export function ProfileScreen() {
  const user = useAuth(s => s.user);
  const clearSession = useAuth(s => s.clearSession);
  const mtgApiUrl = useAuth(s => s.mtgApiUrl);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <Text style={styles.title}>Account</Text>
        {user ? (
          <View style={styles.card}>
            {user.displayName ? <Row label="Name" value={user.displayName} /> : null}
            <Row label="Email" value={user.sub} mono />
            {user.isAdmin ? <Row label="Role" value="Admin" /> : null}
          </View>
        ) : null}

        <Text style={styles.section}>Endpoint</Text>
        <View style={styles.card}>
          <Row label="API" value={mtgApiUrl} mono />
        </View>

        <Pressable onPress={() => void clearSession()} style={styles.signOutButton}>
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
