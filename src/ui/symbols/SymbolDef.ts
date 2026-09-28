export type SvgNode = {
  t: 'g' | 'path' | 'circle';
  a?: Record<string, string>;
  c?: SvgNode[];
};

export type SymbolDef = {
  /** Scryfall's English reading, e.g. "one white mana or two life". */
  label: string;
  viewBox: string;
  nodes: SvgNode[];
};
