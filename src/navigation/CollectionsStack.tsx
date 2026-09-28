import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SettingsButton } from '../components/SettingsButton';
import { CollectionsListScreen } from '../features/collections/CollectionsListScreen';
import { CollectionDetailScreen } from '../features/collections/CollectionDetailScreen';
import { CardDetailScreen } from '../features/search/CardDetailScreen';
import { PrintingDetailScreen } from '../features/search/PrintingDetailScreen';
import { stackScreenOptions } from './stackScreenOptions';
import { CollectionsStackParamList } from './types';

const Stack = createNativeStackNavigator<CollectionsStackParamList>();

export function CollectionsStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="Collections"
        component={CollectionsListScreen}
        options={{ title: 'Collections', headerRight: () => <SettingsButton /> }}
      />
      <Stack.Screen name="CollectionDetail" component={CollectionDetailScreen} options={{ title: 'Collection' }} />
      <Stack.Screen name="CardDetail" component={CardDetailScreen} options={{ title: 'Card' }} />
      <Stack.Screen
        name="PrintingDetail"
        component={PrintingDetailScreen}
        options={{ title: 'Printing' }}
      />
    </Stack.Navigator>
  );
}
