import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthGate } from './AuthGate';
import { NarratorScreen } from '../screens/NarratorScreen';
import { RootTabParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();

export function RootTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#000', borderTopColor: '#222' },
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#6e7686',
      }}
    >
      <Tab.Screen name="MTG" component={AuthGate} options={{ title: 'MTG' }} />
      <Tab.Screen name="Narrator" component={NarratorScreen} options={{ title: 'Narrator' }} />
    </Tab.Navigator>
  );
}
