import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  name: IconName;
  size?: number;
  /**
   * Semantic color tokens, mapped to the theme. Pass a raw hex color via
   * `tint` if you need a one-off shade (e.g. tab bar tint controlled by
   * navigation library, or a per-overlay opacity).
   */
  color?: 'primary' | 'muted' | 'faint' | 'destructive' | 'success' | 'warning' | 'body' | 'white';
  tint?: string;
  style?: React.ComponentProps<typeof Ionicons>['style'];
};

const COLOR_MAP: Record<NonNullable<Props['color']>, string> = {
  primary: colors.primary,
  muted: colors.textMuted,
  faint: colors.textFaint,
  destructive: colors.destructive,
  success: colors.success,
  warning: colors.warning,
  body: colors.textBody,
  white: '#fff',
};

export function Icon({ name, size = 18, color = 'body', tint, style }: Props) {
  const resolved = tint ?? COLOR_MAP[color];
  return <Ionicons name={name} size={size} color={resolved} style={style} />;
}
