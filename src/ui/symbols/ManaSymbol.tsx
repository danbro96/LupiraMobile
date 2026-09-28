import React, { memo } from 'react';
import { Text } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { findSymbol } from './findSymbol';
import type { SvgNode } from './SymbolDef';

const ELEMENTS = { g: G, path: Path, circle: Circle } as const;

function renderNode(node: SvgNode, key: number): React.ReactNode {
  const Element = ELEMENTS[node.t] as React.ComponentType<Record<string, unknown>>;
  return (
    <Element key={key} {...node.a}>
      {node.c?.map(renderNode)}
    </Element>
  );
}

/** One card symbol (`W`, `2/U`, `T`, …). Codes Scryfall doesn't know render as `{code}` text. */
export const ManaSymbol = memo(function ManaSymbol({ code, size = 16 }: { code: string; size?: number }) {
  const def = findSymbol(code);
  if (!def) return <Text style={{ fontSize: size * 0.8 }}>{`{${code}}`}</Text>;
  return (
    <Svg width={size} height={size} viewBox={def.viewBox} accessibilityLabel={def.label}>
      {def.nodes.map(renderNode)}
    </Svg>
  );
});
