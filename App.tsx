import { StatusBar } from 'expo-status-bar';
import { NarratorScreen } from './src/screens/NarratorScreen';

export default function App() {
  return (
    <>
      <NarratorScreen />
      <StatusBar style="auto" />
    </>
  );
}
