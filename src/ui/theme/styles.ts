import type { Palette } from './colors';
import { radii, spacing } from './spacing';

/** The card surface every screen groups content in. Not Paper's `Card`: most of these render inside
 *  memo'd list rows, where a per-row `useTheme()` is what the row rules exist to keep out. */
export const cardSurface = (c: Palette) => ({
  backgroundColor: c.surface,
  borderRadius: radii.lg,
  padding: spacing.md,
  gap: spacing.xs,
});
