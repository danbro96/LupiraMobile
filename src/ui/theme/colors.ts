import { DARK, LIGHT, type ColorScheme } from './tokens/color';

/** The shared estate core plus MTG's own status semantics. */
export interface Palette extends ColorScheme {
  warning: string;
  success: string;
  /** Backdrop behind a destructive/error notice. */
  dangerBg: string;
}

export const lightColors: Palette = {
  ...LIGHT,
  warning: '#5b4b18',
  success: '#1f7a4d',
  dangerBg: '#fbe9e7',
};

export const darkColors: Palette = {
  ...DARK,
  warning: '#d8b24a',
  success: '#5fd49b',
  dangerBg: '#2a1414',
};

/** WUBRG colour identity. Fixed across schemes — these are the game's colours, not UI. */
export const MANA = {
  W: { fill: '#f8f3df', border: '#cdc7a8', text: '#1a1f29' },
  U: { fill: '#1f6dc4', border: '#5396e0', text: '#ffffff' },
  B: { fill: '#3a3033', border: '#6e6168', text: '#ffffff' },
  R: { fill: '#c83838', border: '#e25c5c', text: '#ffffff' },
  G: { fill: '#1f7a4d', border: '#34a36c', text: '#ffffff' },
} as const;
