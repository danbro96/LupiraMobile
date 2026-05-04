import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ScanScreen } from '../features/scan/ScanScreen';
import { ScanSettingsScreen } from '../features/scan/ScanSettingsScreen';
import { SelectionScreen } from '../features/scan/SelectionScreen';
import { PickCollectionScreen } from '../features/scan/PickCollectionScreen';
import { CardDetailScreen } from '../features/search/CardDetailScreen';
import { ScanStackParamList } from './types';

const Stack = createNativeStackNavigator<ScanStackParamList>();

const screenOptions = {
  headerStyle: { backgroundColor: '#0e1117' },
  headerTitleStyle: { color: '#f5f5f5' },
  headerTintColor: '#3b82f6',
  contentStyle: { backgroundColor: '#0e1117' },
} as const;

export function ScanStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Scan" component={ScanScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="ScanSettings"
        component={ScanSettingsScreen}
        options={{ title: 'Scan settings' }}
      />
      <Stack.Screen name="Selection" component={SelectionScreen} options={{ title: 'Selection' }} />
      <Stack.Screen
        name="PickCollection"
        component={PickCollectionScreen}
        options={{ title: 'Commit to…', presentation: 'modal' }}
      />
      <Stack.Screen name="CardDetail" component={CardDetailScreen} options={{ title: 'Card' }} />
    </Stack.Navigator>
  );
}
