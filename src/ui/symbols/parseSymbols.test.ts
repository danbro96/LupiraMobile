import { describe, expect, it } from 'vitest';
import { extraIdentity, parseRulesText, parseSymbols, spokenText } from './parseSymbols';
import { findSymbol } from './findSymbol';

describe('parseSymbols', () => {
  it('splits a mana cost into symbols', () => {
    expect(parseSymbols('{10}{W/U}{G/U/P}{½}')).toEqual([
      { kind: 'symbol', code: '10' },
      { kind: 'symbol', code: 'W/U' },
      { kind: 'symbol', code: 'G/U/P' },
      { kind: 'symbol', code: '½' },
    ]);
  });

  it('keeps surrounding text', () => {
    expect(parseSymbols('{T}: Add {G}.')).toEqual([
      { kind: 'symbol', code: 'T' },
      { kind: 'text', text: ': Add ' },
      { kind: 'symbol', code: 'G' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves split-card separators and unclosed braces as text', () => {
    expect(parseSymbols('{R} // {2}{G')).toEqual([
      { kind: 'symbol', code: 'R' },
      { kind: 'text', text: ' // ' },
      { kind: 'symbol', code: '2' },
      { kind: 'text', text: '{G' },
    ]);
  });

  it('returns nothing for empty text', () => {
    expect(parseSymbols('')).toEqual([]);
  });
});

describe('parseRulesText', () => {
  it('marks parenthesised reminder text, including symbols inside it', () => {
    const spans = parseRulesText('Flying\nEquip {1} ({1}: Attach.)');
    expect(spans.map(s => s.reminder)).toEqual([false, true]);
    expect(spans[1].tokens[1]).toEqual({ kind: 'symbol', code: '1' });
  });
});

describe('spokenText', () => {
  it('reads known symbols and leaves unknown ones as written', () => {
    expect(spokenText('{T}: Add {G}. {NOPE}', code => findSymbol(code)?.label)).toBe(
      'tap this permanent: Add one green mana. {NOPE}',
    );
  });
});

describe('findSymbol', () => {
  it('ignores case and hybrid order', () => {
    expect(findSymbol('w/u')).toBe(findSymbol('W/U'));
    expect(findSymbol('U/W')).toBe(findSymbol('W/U'));
    expect(findSymbol('P/G')).toBe(findSymbol('G/P'));
  });
});

describe('extraIdentity', () => {
  it('hides identity the cost already shows', () => {
    expect(extraIdentity(['G'], '{G}')).toEqual([]);
    expect(extraIdentity(['W', 'U'], '{1}{W/U}{U/P}')).toEqual([]);
  });

  it('keeps identity with colours outside the cost', () => {
    expect(extraIdentity(['G', 'R'], '{G}')).toEqual(['G', 'R']);
    expect(extraIdentity(['G'], null)).toEqual(['G']);
  });
});
