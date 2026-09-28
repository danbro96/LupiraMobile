import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme';
import { findSymbol } from './findSymbol';
import { ManaSymbol } from './ManaSymbol';
import { parseSymbols, spokenText } from './parseSymbols';

const labelOf = (code: string) => findSymbol(code)?.label;

/** A mana cost as a row of symbols; split and adventure costs keep their ` // ` separator. */
export function ManaCost({ cost, size = 16 }: { cost: string | null | undefined; size?: number }) {
  const c = useColors();
  const tokens = useMemo(() => (cost ? parseSymbols(cost) : []), [cost]);
  if (tokens.length === 0) return null;
  return (
    <View style={styles.row} accessible accessibilityLabel={spokenText(cost!, labelOf)}>
      {tokens.map((token, i) =>
        token.kind === 'symbol' ? (
          <ManaSymbol key={i} code={token.code} size={size} />
        ) : (
          <Text key={i} style={{ color: c.textSubtle, fontSize: size * 0.8 }}>{token.text.trim()}</Text>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
