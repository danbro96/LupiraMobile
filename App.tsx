import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './src/query/queryClient';
import { AuthGate } from './src/navigation/AuthGate';
import { useAuth } from './src/store/auth-store';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://dcb0e67aeb971bbec6f13deca66bea4c@o4511341575733248.ingest.de.sentry.io/4511341579862096',

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

export default Sentry.wrap(function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      await useAuth.getState().load();
      // Renew a still-valid-but-near-expiry token before the first request; a transient failure
      // keeps the session (the mutator's 401 path is the reactive safety net).
      await useAuth.getState().refreshIfNeeded();
      setReady(true);
    })();
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <AuthGate />
        </NavigationContainer>
      </QueryClientProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
});
