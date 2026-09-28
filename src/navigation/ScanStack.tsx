import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SettingsButton } from '../ui/components/SettingsButton';
import { ScanScreen } from '../features/scan/ScanScreen';
import { SelectionScreen } from '../features/scan/SelectionScreen';
import { PickCollectionScreen } from '../features/scan/PickCollectionScreen';
import { PrintingPickerScreen } from '../features/scan/PrintingPickerScreen';
import { CardDetailScreen } from '../features/search/CardDetailScreen';
import { PrintingDetailScreen } from '../features/search/PrintingDetailScreen';
import { ScanStackParamList } from './types';

const Stack = createNativeStackNavigator<ScanStackParamList>();

export function ScanStack() {
  return (
    <Stack.Navigator>
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
      <Stack.Screen name="PrintingPicker" component={PrintingPickerScreen} options={{ title: 'Find card' }} />
      <Stack.Screen name="CardDetail" component={CardDetailScreen} options={{ title: 'Card' }} />
      <Stack.Screen
        name="PrintingDetail"
        component={PrintingDetailScreen}
        options={{ title: 'Printing' }}
      />
    </Stack.Navigator>
  );
}
