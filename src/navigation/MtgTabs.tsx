import React from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MtgStack } from './MtgStack';
import { ScanStack } from './ScanStack';
import { CollectionsStack } from './CollectionsStack';
import { MtgTabParamList } from './types';
import { useColors } from '../ui/theme';
import { ICONS } from '../ui/icons';

const Tab = createBottomTabNavigator<MtgTabParamList>();

export function MtgTabs() {
  const c = useColors();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
      }}
    >
      <Tab.Screen
        name="SearchTab"
        component={MtgStack}
        options={{
          title: 'Cards',
          tabBarIcon: ({ color, size }) => <MaterialIcons name={ICONS.search} size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="ScanTab"
        component={ScanStack}
        options={{
          title: 'Scan',
          tabBarIcon: ({ color, size }) => <MaterialIcons name={ICONS.scan} size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="CollectionsTab"
        component={CollectionsStack}
        options={{
          title: 'Collections',
          tabBarIcon: ({ color, size }) => <MaterialIcons name={ICONS.folder} size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}
