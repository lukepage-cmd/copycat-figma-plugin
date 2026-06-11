import { partitionSelection, type RawNode } from './partition';
import type { FromSandbox, ToSandbox, SkipDetail } from './messages';

figma.showUI(__html__, { width: 360, height: 420, themeColors: true });

const REASON_TEXT: Record<string, string> = {
  'layer-locked': 'layer locked',
  'mixed-styling': 'mixed styling — edit manually',
  'empty-text': 'empty text',
};

function postSelection(): void {
  const textNodes = figma.currentPage.selection.filter(
    (n): n is TextNode => n.type === 'TEXT',
  );
  const raws: RawNode[] = textNodes.map((n) => ({
    id: n.id,
    name: n.name,
    characters: n.characters,
    locked: n.locked,
    hasMixedFontName: n.fontName === figma.mixed,
    hasMixedFills: n.fills === figma.mixed,
    hasMixedFontSize: n.fontSize === figma.mixed,
  }));
  const items = partitionSelection(raws);
  const msg: FromSandbox = { type: 'selection', items };
  figma.ui.postMessage(msg);
}

postSelection();
figma.on('selectionchange', postSelection);

figma.ui.onmessage = async (msg: ToSandbox) => {
  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }
  if (msg.type !== 'apply') return;

  const skipped: SkipDetail[] = [];
  let translated = 0;

  for (const t of msg.translations) {
    const node = figma.getNodeById(t.id);
    if (!node || node.type !== 'TEXT') {
      skipped.push({ id: t.id, name: '<missing>', reason: 'node not found' });
      continue;
    }
    if (node.locked) {
      skipped.push({ id: t.id, name: node.name, reason: REASON_TEXT['layer-locked']! });
      continue;
    }
    const font = node.fontName;
    if (font === figma.mixed) {
      skipped.push({ id: t.id, name: node.name, reason: REASON_TEXT['mixed-styling']! });
      continue;
    }
    try {
      await figma.loadFontAsync(font);
    } catch {
      skipped.push({
        id: t.id,
        name: node.name,
        reason: `font not loaded: ${font.family} ${font.style}`,
      });
      continue;
    }
    try {
      node.characters = t.text;
      translated += 1;
    } catch (e) {
      skipped.push({
        id: t.id,
        name: node.name,
        reason: e instanceof Error ? e.message : 'apply failed',
      });
    }
  }

  const result: FromSandbox = { type: 'apply-result', translated, skipped };
  figma.ui.postMessage(result);
};
