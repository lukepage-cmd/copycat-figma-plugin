import { partitionSelection, type RawNode } from './partition';
import type { FromSandbox, ToSandbox, SkipDetail, ShrunkDetail } from './messages';

figma.showUI(__html__, { width: 340, height: 220, themeColors: true });

const REASON_TEXT: Record<string, string> = {
  'layer-locked': 'layer locked',
  'mixed-styling': 'mixed styling — edit manually',
  'empty-text': 'empty text',
};

// Translated text often takes more vertical space — French ~20% longer than
// English, German often 30%. After applying a translation we step the font
// size down until the text fits back inside its original bounding-box height.
//
// Tiered floor by original size:
//   < 40pt (body / subtitle / caption) → max 15% shrink. Aggressive shrinking
//     of small copy turns it into illegible micro-type; better to let it wrap.
//   ≥ 40pt (headlines / hero) → max 50% shrink. Headlines can flex more
//     because there's more pixel headroom and they're meant to be impactful.
//
// Absolute min of 14pt below which nothing shrinks further.
const SHRINK_FLOOR_RATIO_SMALL = 0.85;
const SHRINK_FLOOR_RATIO_LARGE = 0.5;
const SHRINK_SIZE_TIER_BREAKPOINT = 40;
const SHRINK_FLOOR_MIN_PT = 14;
const SHRINK_MAX_ITERATIONS = 80;

function shrinkFloor(originalFontSize: number): number {
  const ratio =
    originalFontSize < SHRINK_SIZE_TIER_BREAKPOINT
      ? SHRINK_FLOOR_RATIO_SMALL
      : SHRINK_FLOOR_RATIO_LARGE;
  return Math.max(SHRINK_FLOOR_MIN_PT, originalFontSize * ratio);
}

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
  const floor = shrinkFloor(originalFontSize);
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
  if (msg.type === 'resize') {
    figma.ui.resize(340, Math.max(120, Math.min(640, Math.round(msg.height))));
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
    const originalAutoResize = node.textAutoResize;

    // If the text box is on NONE or TRUNCATE auto-resize, node.height stays at
    // the designer's fixed value regardless of content — which means we can't
    // see overflow by reading node.height. Temporarily switch to HEIGHT
    // auto-resize so the box reflects what the text actually needs; we restore
    // the original setting once shrinking is done. Invisible to the user.
    const needsMeasureSwitch =
      originalAutoResize === 'NONE' || originalAutoResize === 'TRUNCATE';
    if (needsMeasureSwitch) {
      node.textAutoResize = 'HEIGHT';
    }

    try {
      node.characters = t.text;
    } catch (e) {
      if (needsMeasureSwitch) node.textAutoResize = originalAutoResize;
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

    // Restore the designer's original auto-resize behaviour now that we've
    // done our measure-and-shrink.
    if (needsMeasureSwitch && node.textAutoResize !== originalAutoResize) {
      node.textAutoResize = originalAutoResize;
    }

    translated += 1;
  }

  const result: FromSandbox = { type: 'apply-result', translated, skipped, shrunk };
  figma.ui.postMessage(result);
};
