// The estate's shared core, identical across the Lupira frontends — see DevOps
// Guides/design-tokens.md. Product-specific semantics extend it in the app's own Palette.
export type ColorScheme = {
  bg: string;
  surface: string;
  primary: string;
  onPrimary: string;
  border: string;
  divider: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  textDisabled: string;
  danger: string;
  /** Identity surfaces only — the mark, the splash, theme-color, primaryColor. Never the UI:
   *  a second accent competing with `primary` is exactly what the palette work removed. */
  brand: string;
};

export const LIGHT: ColorScheme = {
  bg: '#ffffff',
  surface: '#f5f6f8',
  primary: '#0d9488',
  onPrimary: '#ffffff',
  border: '#d4d8e0',
  divider: '#e3e6ec',
  text: '#1c2230',
  textMuted: '#6e7686',
  textSubtle: '#8a909c',
  textDisabled: '#9aa0ac',
  brand: '#E76F51',
  danger: '#b3261e',
};

export const DARK: ColorScheme = {
  bg: '#14171c',
  surface: '#1e232b',
  primary: '#2dd4bf',
  onPrimary: '#042f2e',
  border: '#2c333d',
  divider: '#252b33',
  text: '#e6e9ee',
  textMuted: '#9aa3b2',
  textSubtle: '#7c8492',
  textDisabled: '#5b626e',
  brand: '#E76F51',
  danger: '#f2675e',
};
