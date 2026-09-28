import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import type { ICONS } from '../icons';

type GlyphName = (typeof ICONS)[keyof typeof ICONS] & ComponentProps<typeof MaterialIcons>['name'];

/**
 * An icon that nests inside `<Text>` — MaterialIcons renders as text, so it flows inline with the
 * label instead of needing its own row. Colour is deliberately not a prop: leaving it unset lets the
 * glyph inherit from the surrounding Text, which is what every call site wants.
 */
export function Glyph({ name, size = 13 }: { name: GlyphName; size?: number }) {
  return <MaterialIcons name={name} size={size} />;
}
