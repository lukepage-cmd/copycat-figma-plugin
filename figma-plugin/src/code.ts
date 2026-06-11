import { partitionSelection, type RawNode } from './partition';
import type { FromSandbox, ToSandbox, SkipDetail, ShrunkDetail } from './messages';

figma.showUI(__html__, { width: 360, height: 480, themeColors: true });

const REASON_TEXT: Record<string, string> = {
  'layer-locked': 'layer locked',
  'mixed-styling': 'mixed styling — edit manually',
  'empty-text': 'empty text',
};

// Translated text in another language often takes more vertical space — French
// is ~20% longer than English on average, German is often 30% longer. After
// applying a translation we step the font size down until the text fits back
// inside its original bounding-box height. Floor is 60% of original (or 8pt,
// whichever is larger) — beyond that the layout was probably never going to
// accommodate the translation cleanly and the designer should review manually.
const SHRINK_FLOOR_RATIO = 0.6;
const SHRINK_FLOOR_MIN_PT = 8;
const SHRINK_MAX_ITERATIONS = 60;

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

function shrinkToFit(node: TextNode, originalHeight: number, originalFontSize: number): number {
  const floor = Math.max(SHRINK_FLOOR_MIN_PT, originalFontSize * SHRINK_FLOOR_RATIO);
  let current = originalFontSize;
  let iterations = 0;
  while (
    node.height > originalHeight + 1 &&
    current > floor &&
    iterations < SHRINK_MAX_ITERATIONS
  ) {
    current = Math.max(floor, current - 1);
    try {
      node.fontSize = current;
    } catch {
      break;
    }
    iterations += 1;
  }
  return current;
}

figma.ui.onmessage = async (msg: ToSandbox) => {
  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }
  if (msg.type !== 'apply') return;

  const skipped: SkipDetail[] = [];
  const shrunk: ShrunkDetail[] = [];
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

    const originalHeight = node.height;
    const originalFontSize = typeof node.fontSize === 'number' ? node.fontSize : null;

    try {
      node.characters = t.text;
    } catch (e) {
      skipped.push({
        id: t.id,
        name: node.name,
        reason: e instanceof Error ? e.message : 'apply failed',
      });
      continue;
    }

    // Auto-shrink if the translation made the box taller than it started.
    if (originalFontSize !== null && node.height > originalHeight + 1) {
      const finalSize = shrinkToFit(node, originalHeight, originalFontSize);
      if (finalSize < originalFontSize) {
        shrunk.push({
          id: t.id,
          name: node.name,
          from: originalFontSize,
          to: finalSize,
        });
      }
    }

    translated += 1;
  }

  const result: FromSandbox = { type: 'apply-result', translated, skipped, shrunk };
  figma.ui.postMessage(result);
};
