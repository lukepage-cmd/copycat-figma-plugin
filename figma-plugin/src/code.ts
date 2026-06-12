import { partitionSelection, type RawNode } from './partition';
import type { FromSandbox, ToSandbox, SkipDetail, ShrunkDetail } from './messages';

figma.showUI(__html__, { width: 340, height: 220, themeColors: true });

const REASON_TEXT: Record<string, string> = {
  'layer-locked': 'layer locked',
  'mixed-styling': 'mixed styling — edit manually',
  'empty-text': 'empty text',
};

// Translated text often grows — French ~20% longer than English, German often
// 30%. After applying a translation we may need to shrink the font so the
// text fits back inside its original bounding box (both width and height).
//
// Strategy: single-shot proportional calculation, plus a short refinement
// loop. Single-line text width and height scale ~linearly with font size,
// so the new font we want is roughly `originalFontSize / max(widthRatio,
// heightRatio)`. We set that directly, then run up to 5 refinement steps
// in case the new size caused text to re-wrap (which breaks the linear
// assumption). This replaces the previous 80-iteration step-down loop,
// which was prone to overshooting because Figma's node.width can lag
// behind node.fontSize updates by a frame or two.
//
// Tiered floor by original size:
//   < 40pt (body / subtitle) → max 15% shrink. Small text shouldn't drop
//     below readability for the sake of fitting.
//   ≥ 40pt (headlines / hero) → max 30% shrink. Headlines flex more, but
//     30% is still a designer-credible amount — 50% looked broken.
// Floors are deliberately conservative — we'd rather a long translation
// overflow its box slightly and need a designer nudge than crush the visual
// hierarchy by aggressively shrinking subtitles relative to headlines.
//   < 40pt: max 15% shrink (small copy stays legible).
//   ≥ 40pt: max 30% shrink (headlines flex but don't get squashed).
// If the translation is so long that 30% shrink isn't enough, we accept the
// residual overflow rather than dropping further.
const SHRINK_FLOOR_RATIO_SMALL = 0.85;
const SHRINK_FLOOR_RATIO_LARGE = 0.7;
const SHRINK_SIZE_TIER_BREAKPOINT = 40;
const SHRINK_FLOOR_MIN_PT = 14;
const SHRINK_MAX_REFINEMENT_ITERATIONS = 5;
const OVERFLOW_TOLERANCE = 1.02; // accept 2% overflow without further shrinking

// pluginData keys: we stamp every text node we touch with its TRUE original
// font size + height + width + auto-resize on first translation. On
// subsequent translations we read these so the "original" baseline doesn't
// drift every time we shrink. Source text is NOT stored — we use whatever
// is on the layer right now as the source for translation. (Storing source
// text caused too much confusion in multi-language testing; designers can
// cmd-Z between cycles or duplicate layers per language.)
const PD_ORIGINAL_FONT_SIZE = 'copycat-original-font-size';
const PD_ORIGINAL_HEIGHT = 'copycat-original-height';
const PD_ORIGINAL_WIDTH = 'copycat-original-width';
const PD_ORIGINAL_AUTORESIZE = 'copycat-original-autoresize';

type OriginalSnapshot = {
  fontSize: number;
  height: number;
  width: number;
  autoResize: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';
};

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

function getOrCaptureOriginal(node: TextNode): OriginalSnapshot | null {
  const storedSize = node.getPluginData(PD_ORIGINAL_FONT_SIZE);
  const storedHeight = node.getPluginData(PD_ORIGINAL_HEIGHT);
  const storedWidth = node.getPluginData(PD_ORIGINAL_WIDTH);
  const storedAutoResize = node.getPluginData(PD_ORIGINAL_AUTORESIZE);

  if (storedSize && storedHeight && storedWidth && storedAutoResize) {
    return {
      fontSize: parseFloat(storedSize),
      height: parseFloat(storedHeight),
      width: parseFloat(storedWidth),
      autoResize: storedAutoResize as OriginalSnapshot['autoResize'],
    };
  }

  if (typeof node.fontSize !== 'number') return null;
  const snapshot: OriginalSnapshot = {
    fontSize: node.fontSize,
    height: node.height,
    width: node.width,
    autoResize: node.textAutoResize,
  };
  node.setPluginData(PD_ORIGINAL_FONT_SIZE, String(snapshot.fontSize));
  node.setPluginData(PD_ORIGINAL_HEIGHT, String(snapshot.height));
  node.setPluginData(PD_ORIGINAL_WIDTH, String(snapshot.width));
  node.setPluginData(PD_ORIGINAL_AUTORESIZE, snapshot.autoResize);
  return snapshot;
}

function shrinkToFit(
  node: TextNode,
  originalHeight: number,
  widthBudget: number,
  originalFontSize: number,
): number {
  const floor = shrinkFloor(originalFontSize);

  const widthRatio = node.width / widthBudget;
  const heightRatio = node.height / originalHeight;
  const maxRatio = Math.max(widthRatio, heightRatio);

  if (maxRatio <= OVERFLOW_TOLERANCE) return originalFontSize;

  let current = Math.max(floor, originalFontSize / maxRatio);
  try {
    node.fontSize = current;
  } catch {
    return originalFontSize;
  }

  let iterations = 0;
  while (
    (node.height > originalHeight * OVERFLOW_TOLERANCE ||
      node.width > widthBudget * OVERFLOW_TOLERANCE) &&
    current > floor &&
    iterations < SHRINK_MAX_REFINEMENT_ITERATIONS
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

    // Use the TRUE original (captured on first ever translation), not the
    // current state — current state may already be shrunk from a previous
    // round. This is what lets EN → FR → EN return cleanly to original size.
    const original = getOrCaptureOriginal(node);
    if (!original) {
      skipped.push({
        id: t.id,
        name: node.name,
        reason: 'cannot read original font size',
      });
      continue;
    }

    // Restore font to original before applying the new translation —
    // ONLY if the current size differs. Skipping no-op writes keeps the
    // undo stack short so a single cmd-Z reverts the visible translation
    // rather than peeling back through invisible property changes.
    if (
      typeof node.fontSize === 'number' &&
      Math.abs(node.fontSize - original.fontSize) > 0.01
    ) {
      try {
        node.fontSize = original.fontSize;
      } catch {
        // Falls through — we still try the translation at current size.
      }
    }

    // For measurement, we want BOTH dimensions to reflect what the text
    // actually needs — so we can detect overflow on either axis. Switch
    // to WIDTH_AND_HEIGHT only if we're not already there, and only
    // restore at the end if we actually switched.
    const needsMeasureSwitch =
      original.autoResize !== 'WIDTH_AND_HEIGHT' &&
      node.textAutoResize !== 'WIDTH_AND_HEIGHT';
    if (needsMeasureSwitch) {
      node.textAutoResize = 'WIDTH_AND_HEIGHT';
    }

    try {
      node.characters = t.text;
    } catch (e) {
      if (needsMeasureSwitch) node.textAutoResize = original.autoResize;
      skipped.push({
        id: t.id,
        name: node.name,
        reason: e instanceof Error ? e.message : 'apply failed',
      });
      continue;
    }

    // Width budget = how wide we're willing to let the box grow before
    // shrinking the font. Fixed-box modes get no budget (must fit exactly).
    // Auto-resize modes (WIDTH_AND_HEIGHT, HEIGHT) get a 25% growth budget —
    // enough that most translations don't trigger shrink, but capping the
    // sprawl of languages like Greek and Japanese that can be 30-50% wider.
    const isFixedBox =
      original.autoResize === 'NONE' || original.autoResize === 'TRUNCATE';
    const widthGrowthAllowance = isFixedBox ? 1.0 : 1.25;
    const widthBudget = original.width * widthGrowthAllowance;

    if (
      node.height > original.height * OVERFLOW_TOLERANCE ||
      node.width > widthBudget * OVERFLOW_TOLERANCE
    ) {
      const finalSize = shrinkToFit(
        node,
        original.height,
        widthBudget,
        original.fontSize,
      );
      if (finalSize < original.fontSize) {
        shrunk.push({
          id: t.id,
          name: node.name,
          from: original.fontSize,
          to: finalSize,
        });
      }
    }

    if (needsMeasureSwitch && node.textAutoResize !== original.autoResize) {
      node.textAutoResize = original.autoResize;
    }

    translated += 1;
  }

  const result: FromSandbox = { type: 'apply-result', translated, skipped, shrunk };
  figma.ui.postMessage(result);
};
