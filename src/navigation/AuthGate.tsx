import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuthSession } from '../auth/AuthProvider';
import { LoginScreen } from '../features/me/LoginScreen';
import { MtgTabs } from './MtgTabs';

export function AuthGate() {
  const { loaded, isAuthenticated } = useAuthSession();

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return isAuthenticated ? <MtgTabs /> : <LoginScreen />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0e1117' },
});
