import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../store/auth-store';
import { LoginScreen } from '../features/me/LoginScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { ScanSettingsScreen } from '../features/scan/ScanSettingsScreen';
import { ScanDebugLogScreen } from '../features/scan/ScanDebugLogScreen';
import { useColors } from '../ui/theme';
import { MtgTabs } from './MtgTabs';
import { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Auth-gated: Login until signed in, then the tabs with Settings and its sub-screens pushed over them.
export function RootStack() {
  const c = useColors();
  const loaded = useAuth(s => s.loaded);
  const authed = useAuth(s => !!s.token && !!s.user);

  if (!loaded) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack.Navigator>
      {authed ? (
        <>
          <Stack.Screen name="Tabs" component={MtgTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
          <Stack.Screen name="ScanSettings" component={ScanSettingsScreen} options={{ title: 'Scan tuning' }} />
          <Stack.Screen name="ScanDebugLog" component={ScanDebugLogScreen} options={{ title: 'Scan debug log' }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
