import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SettingsButton } from '../components/SettingsButton';
import { ScanScreen } from '../features/scan/ScanScreen';
import { SelectionScreen } from '../features/scan/SelectionScreen';
import { PickCollectionScreen } from '../features/scan/PickCollectionScreen';
import { CardDetailScreen } from '../features/search/CardDetailScreen';
import { PrintingDetailScreen } from '../features/search/PrintingDetailScreen';
import { stackScreenOptions } from './stackScreenOptions';
import { ScanStackParamList } from './types';

const Stack = createNativeStackNavigator<ScanStackParamList>();

export function ScanStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="Scan"
        component={ScanScreen}
        options={{ title: 'Scan', headerRight: () => <SettingsButton /> }}
      />
      <Stack.Screen name="Selection" component={SelectionScreen} options={{ title: 'Selection' }} />
      <Stack.Screen
        name="PickCollection"
        component={PickCollectionScreen}
        options={{ title: 'Commit to…', presentation: 'modal' }}
      />
      <Stack.Screen name="CardDetail" component={CardDetailScreen} options={{ title: 'Card' }} />
      <Stack.Screen
        name="PrintingDetail"
        component={PrintingDetailScreen}
        options={{ title: 'Printing' }}
      />
    </Stack.Navigator>
  );
}
