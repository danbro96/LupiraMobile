export const colors = {
  background: '#0e1117',
  surface: '#1a1f29',
  surfaceMuted: '#2c3340',
  surfaceFaint: '#101622',
  border: '#1a1f29',

  textPrimary: '#f5f5f5',
  textBody: '#cbd1da',
  textMuted: '#9aa3b2',
  textFaint: '#6e7686',

  primary: '#3b82f6',
  primaryBright: '#60a5fa',
  destructive: '#f97373',
  destructiveBg: '#2a1414',
  warning: '#f59e0b',
  success: '#22c55e',

  cameraDimText: 'rgba(255,255,255,0.5)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

export const font = {
  // Sizes ordered small → large.
  caption: 11,
  small: 12,
  body: 14,
  bodyLg: 15,
  title: 16,
  heading: 18,
  display: 28,
  // Common monospace sizes used across the debug HUD.
  mono: 11,
  monoSmall: 10,
} as const;
