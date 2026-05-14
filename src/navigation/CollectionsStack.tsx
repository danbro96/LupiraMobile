import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CollectionsListScreen } from '../features/collections/CollectionsListScreen';
import { CollectionDetailScreen } from '../features/collections/CollectionDetailScreen';
import { CardDetailScreen } from '../features/search/CardDetailScreen';
import { PrintingDetailScreen } from '../features/search/PrintingDetailScreen';
import { CollectionsStackParamList } from './types';

const Stack = createNativeStackNavigator<CollectionsStackParamList>();

const screenOptions = {
  headerStyle: { backgroundColor: '#0e1117' },
  headerTitleStyle: { color: '#f5f5f5' },
  headerTintColor: '#3b82f6',
  contentStyle: { backgroundColor: '#0e1117' },
} as const;

export function CollectionsStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Collections" component={CollectionsListScreen} options={{ headerShown: false }} />
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
