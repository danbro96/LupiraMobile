import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MANA, useColors, type Palette } from '../../ui/theme';

/**
 * Tiny coloured circles for the WUBRG colour identity. Renders nothing for
 * colourless cards. Used by the search-result rows and the card-detail
 * header so the user can recognise colour identity at a glance — the
 * single most useful filter signal on a name search.
 */
export function ColorPips({ colors }: { colors: string[] }) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  if (!colors || colors.length === 0) return null;
  return (
    <View style={styles.row}>
      {colors.map((color) => {
        const mana = MANA[color as keyof typeof MANA];
        return (
          <View
            key={color}
            style={[styles.pip, mana && { backgroundColor: mana.fill, borderColor: mana.border }]}
          >
            <Text style={[styles.pipText, mana && { color: mana.text }]}>{color}</Text>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: 3 },
    pip: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.border,
      borderColor: c.textSubtle,
    },
    pipText: { fontSize: 9, fontWeight: '700', color: c.text },
  });
