import { useTheme } from 'react-native-paper';
import type { Palette } from './colors';
import type { AppTheme } from './paperTheme';

/** The active palette, read off the Paper theme PaperProvider is actually holding.
 *  Deriving it from useColorScheme() again would be a second source that can disagree. */
export function useColors(): Palette {
  return useTheme<AppTheme>().colors;
}
