import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NarratorScreen } from './src/screens/NarratorScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <NarratorScreen />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
