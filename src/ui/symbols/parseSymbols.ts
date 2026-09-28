export type SymbolToken = { kind: 'text'; text: string } | { kind: 'symbol'; code: string };

export type RulesSpan = { reminder: boolean; tokens: SymbolToken[] };

const SYMBOL = /\{([^{}]+)\}/g;
const REMINDER = /(\([^()]*\))/;
const WUBRG = new Set(['W', 'U', 'B', 'R', 'G']);

/** Splits Scryfall-style text (`{2}{W}`, `{T}: Add {G}.`) into plain text and `{…}` symbol codes. */
export function parseSymbols(text: string): SymbolToken[] {
  const tokens: SymbolToken[] = [];
  let last = 0;
  for (const match of text.matchAll(SYMBOL)) {
    if (match.index > last) tokens.push({ kind: 'text', text: text.slice(last, match.index) });
    tokens.push({ kind: 'symbol', code: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) });
  return tokens;
}

/** Rules text with parenthesised reminder text split out, since cards print it in italics. */
export function parseRulesText(text: string): RulesSpan[] {
  return text
    .split(REMINDER)
    .filter(part => part.length > 0)
    .map(part => ({ reminder: REMINDER.test(part), tokens: parseSymbols(part) }));
}

/** Screen-reader text: inline symbol views inside `Text` aren't announced, so the parent carries the reading. */
export function spokenText(text: string, labelOf: (code: string) => string | undefined): string {
  return text.replace(SYMBOL, (raw, code: string) => labelOf(code) ?? raw);
}

/** WUBRG colours printed in a cost, including hybrid and Phyrexian halves. */
export function costColors(cost: string | null | undefined): Set<string> {
  const colors = new Set<string>();
  for (const token of parseSymbols(cost ?? '')) {
    if (token.kind !== 'symbol') continue;
    for (const part of token.code.toUpperCase().split('/')) if (WUBRG.has(part)) colors.add(part);
  }
  return colors;
}

/** Colour identity worth showing beside a cost: hidden when the cost already shows every colour in it. */
export function extraIdentity(identity: string[], cost: string | null | undefined): string[] {
  const shown = costColors(cost);
  return identity.some(color => !shown.has(color)) ? identity : [];
}
