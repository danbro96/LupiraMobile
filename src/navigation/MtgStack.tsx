import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SearchScreen } from '../features/search/SearchScreen';
import { CardDetailScreen } from '../features/search/CardDetailScreen';
import { PrintingDetailScreen } from '../features/search/PrintingDetailScreen';
import { SearchStackParamList } from './types';

const Stack = createNativeStackNavigator<SearchStackParamList>();

const screenOptions = {
  headerStyle: { backgroundColor: '#0e1117' },
  headerTitleStyle: { color: '#f5f5f5' },
  headerTintColor: '#3b82f6',
  contentStyle: { backgroundColor: '#0e1117' },
} as const;

export function MtgStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Search" component={SearchScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CardDetail" component={CardDetailScreen} options={{ title: 'Card' }} />
      <Stack.Screen
        name="PrintingDetail"
        component={PrintingDetailScreen}
        options={{ title: 'Printing' }}
      />
    </Stack.Navigator>
  );
}
