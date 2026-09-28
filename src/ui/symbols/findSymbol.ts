import type { SymbolDef } from './SymbolDef';
import { SYMBOLS } from './generated/symbolData';

const canonical = (code: string) => code.toUpperCase().split('/').sort().join('/');

// Hybrid halves are occasionally written in the other order (`{U/W}`, `{P/G}`); match on the set of halves.
const byCanonical = new Map(Object.entries(SYMBOLS).map(([code, def]) => [canonical(code), def]));

export function findSymbol(code: string): SymbolDef | undefined {
  return SYMBOLS[code] ?? SYMBOLS[code.toUpperCase()] ?? byCanonical.get(canonical(code));
}
