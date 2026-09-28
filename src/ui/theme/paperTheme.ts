import { MD3DarkTheme, MD3LightTheme, adaptNavigationTheme } from 'react-native-paper';
import { DarkTheme as NavDarkBase, DefaultTheme as NavLightBase } from '@react-navigation/native';
import { darkColors, lightColors, type Palette } from './colors';
import { radii } from './spacing';

// The whole palette rides on the theme: MD3 gets its own slot names, and the app's vocabulary
// (bg/text/status) comes along so useColors() can read it back off the theme
// rather than deriving the scheme a second time.
function md3Colors(p: Palette) {
  return {
    ...p,
    primary: p.primary,
    onPrimary: p.onPrimary,
    background: p.bg,
    onBackground: p.text,
    surface: p.surface,
    onSurface: p.text,
    onSurfaceVariant: p.textMuted,
    outline: p.border,
    outlineVariant: p.divider,
    error: p.danger,
    // SegmentedButtons paints its selected segment from these.
    secondaryContainer: p.primary,
    onSecondaryContainer: p.onPrimary,
  };
}

export const paperLight = { ...MD3LightTheme, roundness: radii.sm, colors: { ...MD3LightTheme.colors, ...md3Colors(lightColors) } };
export const paperDark = { ...MD3DarkTheme, roundness: radii.sm, colors: { ...MD3DarkTheme.colors, ...md3Colors(darkColors) } };

export type AppTheme = typeof paperLight;

const adapted = adaptNavigationTheme({
  reactNavigationLight: NavLightBase,
  reactNavigationDark: NavDarkBase,
  materialLight: paperLight,
  materialDark: paperDark,
});

export const navLight = adapted.LightTheme;
export const navDark = adapted.DarkTheme;
