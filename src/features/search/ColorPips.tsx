import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ManaSymbol } from '../../ui/symbols';

const COLOR_NAMES: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/**
 * WUBRG colour identity as mana symbols. Renders nothing for colourless cards. Used by the
 * search-result rows and the card-detail header so the user can recognise colour identity at a
 * glance — the single most useful filter signal on a name search.
 */
export function ColorPips({ colors, size = 16 }: { colors: string[]; size?: number }) {
  if (!colors || colors.length === 0) return null;
  return (
    <View style={styles.row} accessible accessibilityLabel={`Colour identity: ${colors.map(color => COLOR_NAMES[color] ?? color).join(', ')}`}>
      {colors.map((color) => <ManaSymbol key={color} code={color} size={size} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 3 },
});
