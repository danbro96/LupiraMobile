import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { MtgStack } from './MtgStack';
import { ScanStack } from './ScanStack';
import { CollectionsStack } from './CollectionsStack';
import { ProfileScreen } from '../features/me/ProfileScreen';
import { MtgTabParamList } from './types';

const Tab = createBottomTabNavigator<MtgTabParamList>();

export function MtgTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0e1117', borderTopColor: '#1a1f29' },
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#6e7686',
      }}
    >
      <Tab.Screen
        name="SearchTab"
        component={MtgStack}
        options={{
          title: 'Cards',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'search' : 'search-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ScanTab"
        component={ScanStack}
        options={{
          title: 'Scan',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'scan' : 'scan-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="CollectionsTab"
        component={CollectionsStack}
        options={{
          title: 'Collections',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'folder' : 'folder-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          title: 'Me',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
