import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
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
      <Tab.Screen
        name="MTG"
        component={AuthGate}
        options={{
          title: 'MTG',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'albums' : 'albums-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Narrator"
        component={NarratorScreen}
        options={{
          title: 'Narrator',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'mic' : 'mic-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
