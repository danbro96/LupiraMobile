import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { Text, useTheme, type MD3Theme, type MD3TypescaleKey } from 'react-native-paper';
import { findSymbol } from './findSymbol';
import { ManaSymbol } from './ManaSymbol';
import { parseRulesText, spokenText, type SymbolToken } from './parseSymbols';

const labelOf = (code: string) => findSymbol(code)?.label;

type Props = {
  text: string;
  variant?: `${MD3TypescaleKey}`;
  style?: StyleProp<TextStyle>;
};

/** Rules text with inline card symbols and italic reminder text, as printed on the card. */
export function SymbolText({ text, variant = 'bodyMedium', style }: Props) {
  const theme = useTheme<MD3Theme>();
  const fontSize = StyleSheet.flatten(style)?.fontSize ?? theme.fonts[variant].fontSize ?? 14;
  const size = Math.round(fontSize * 0.95);
  const spans = useMemo(() => parseRulesText(text), [text]);

  return (
    <Text variant={variant} style={style} accessibilityLabel={spokenText(text, labelOf)}>
      {spans.map((span, i) =>
        span.reminder ? (
          <Text key={i} variant={variant} style={[style, styles.reminder]}>
            {renderTokens(span.tokens, size)}
          </Text>
        ) : (
          <React.Fragment key={i}>{renderTokens(span.tokens, size)}</React.Fragment>
        ),
      )}
    </Text>
  );
}

function renderTokens(tokens: SymbolToken[], size: number) {
  return tokens.map((token, i) =>
    token.kind === 'text' ? (
      token.text
    ) : (
      // Inline views sit on the text baseline; nudge down so the symbol centres on the x-height like print.
      <View key={i} style={{ paddingHorizontal: 1, transform: [{ translateY: size * 0.15 }] }}>
        <ManaSymbol code={token.code} size={size} />
      </View>
    ),
  );
}

const styles = StyleSheet.create({
  reminder: { fontStyle: 'italic' },
});
