import type { SelectionItem, SkipReason } from './messages';

export type RawNode = {
  id: string;
  name: string;
  characters: string;
  locked: boolean;
  hasMixedFontName: boolean;
  hasMixedFills: boolean;
  hasMixedFontSize: boolean;
};

export function partitionSelection(nodes: RawNode[]): SelectionItem[] {
  return nodes.map(toItem);
}

function toItem(node: RawNode): SelectionItem {
  return {
    id: node.id,
    name: node.name,
    characters: node.characters,
    skipReason: detectSkip(node),
  };
}

function detectSkip(node: RawNode): SkipReason | null {
  if (node.locked) return 'layer-locked';
  if (node.hasMixedFontName || node.hasMixedFills || node.hasMixedFontSize) {
    return 'mixed-styling';
  }
  if (node.characters.trim().length === 0) return 'empty-text';
  return null;
}
