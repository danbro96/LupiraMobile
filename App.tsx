import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './src/auth/AuthProvider';
import { queryClient } from './src/query/queryClient';
import { RootTabs } from './src/navigation/RootTabs';

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NavigationContainer>
            <RootTabs />
          </NavigationContainer>
        </AuthProvider>
      </QueryClientProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
