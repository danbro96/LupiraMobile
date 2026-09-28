import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { colors } from '../components/theme';

export const stackScreenOptions: NativeStackNavigationOptions = {
  headerStyle: { backgroundColor: colors.background },
  headerTitleStyle: { color: colors.textPrimary },
  headerTintColor: colors.primary,
  contentStyle: { backgroundColor: colors.background },
};
