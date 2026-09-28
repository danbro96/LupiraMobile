import React from 'react';
import { Pressable } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Icon } from './Icon';
import type { RootStackParamList } from '../navigation/types';

/** The one settings affordance, in each tab's header. Settings lives on the root stack;
 *  `navigate` bubbles up from the tab's nested stack. */
export function SettingsButton() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  return (
    <Pressable onPress={() => navigation.navigate('Settings')} accessibilityLabel="Settings" hitSlop={8}>
      <Icon name="settings-outline" size={22} color="primary" />
    </Pressable>
  );
}
