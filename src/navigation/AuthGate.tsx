import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../store/auth-store';
import { LoginScreen } from '../features/me/LoginScreen';
import { MtgTabs } from './MtgTabs';

export function AuthGate() {
  const loaded = useAuth(s => s.loaded);
  const authed = useAuth(s => !!s.token && !!s.user);

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return authed ? <MtgTabs /> : <LoginScreen />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0e1117' },
});
