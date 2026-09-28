import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';

type Glyph = ComponentProps<typeof MaterialIcons>['name'];

/**
 * Paper renders `icon` strings through MaterialCommunityIcons by default; the estate is on Google
 * Material on both tiers, so every Paper icon resolves here instead. The cast is unavoidable — Paper
 * types `name` as an MCI glyph, which is the very thing this replaces; `ui/icons.ts` is what keeps
 * the names honest. `direction` is Paper's RTL hint, not a MaterialIcons prop, so it is dropped.
 */
export const paperSettings = {
  icon: ({ name, color, size }: { name: string; color?: string; size: number }) => (
    <MaterialIcons name={name as Glyph} color={color} size={size} />
  ),
};
