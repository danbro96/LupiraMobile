import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Tiny coloured circles for the WUBRG colour identity. Renders nothing for
 * colourless cards. Used by the search-result rows and the card-detail
 * header so the user can recognise colour identity at a glance — the
 * single most useful filter signal on a name search.
 */
export function ColorPips({ colors }: { colors: string[] }) {
  if (!colors || colors.length === 0) return null;
  return (
    <View style={styles.row}>
      {colors.map((c) => (
        <View
          key={c}
          style={[
            styles.pip,
            {
              backgroundColor: PIP_FILL[c] ?? '#2c3340',
              borderColor: PIP_BORDER[c] ?? '#6e7686',
            },
          ]}
        >
          <Text style={[styles.pipText, { color: PIP_TEXT[c] ?? '#f5f5f5' }]}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

// MTG colour palette, dark-theme-tuned. Borders are slightly brighter than
// fills so adjacent pips stay distinct against the row background.
const PIP_FILL: Record<string, string> = {
  W: '#f8f3df',
  U: '#1f6dc4',
  B: '#3a3033',
  R: '#c83838',
  G: '#1f7a4d',
};
const PIP_BORDER: Record<string, string> = {
  W: '#cdc7a8',
  U: '#5396e0',
  B: '#6e6168',
  R: '#e25c5c',
  G: '#34a36c',
};
const PIP_TEXT: Record<string, string> = {
  W: '#1a1f29',
  U: '#fff',
  B: '#fff',
  R: '#fff',
  G: '#fff',
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 3 },
  pip: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipText: { fontSize: 9, fontWeight: '700' },
});
