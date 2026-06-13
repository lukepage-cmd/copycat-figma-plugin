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
// Floors give the shrink algorithm room to handle extreme translations
// (very small text + very long translation = needs aggressive shrink to
// avoid overflow). Single-shot calculation only shrinks *as much as
// needed*, so a low floor doesn't make normal cases more aggressive —
// it just stops them from hitting the floor unnecessarily.
//   < 40pt: max 40% shrink (small copy + long languages can need this,
//     e.g. a TRUSTED BY badge translating from 3 lines of English to 5
//     lines of French at the same font size).
//   ≥ 40pt: max 30% shrink (headlines flex but don't get squashed).
const SHRINK_FLOOR_RATIO_SMALL = 0.6;
const SHRINK_FLOOR_RATIO_LARGE = 0.7;
const SHRINK_SIZE_TIER_BREAKPOINT = 40;
// Absolute minimum font size in points. Set low (8pt) so the algorithm
// can handle extreme cases like small-caps trust badges where the
// original is already 12-14pt and the translation needs aggressive
// shrink. Single-shot calculation only goes this low when it has to —
// the floor doesn't make normal cases more aggressive.
const SHRINK_FLOOR_MIN_PT = 8;
const SHRINK_MAX_REFINEMENT_ITERATIONS = 5;
const SHRINK_MAX_GROW_ITERATIONS = 20;
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

  // Shrink refinement: if single-shot was an underestimate (text re-wraps
  // at the smaller size and still overflows), step down further.
  let shrinkIterations = 0;
  while (
    (node.height > originalHeight * OVERFLOW_TOLERANCE ||
      node.width > widthBudget * OVERFLOW_TOLERANCE) &&
    current > floor &&
    shrinkIterations < SHRINK_MAX_REFINEMENT_ITERATIONS
  ) {
    current = Math.max(floor, current - 1);
    try {
      node.fontSize = current;
    } catch {
      break;
    }
    shrinkIterations += 1;
  }

  // Grow-back: single-shot OVERSHRINKS when text wraps because the height
  // ratio is non-linear. Example: "Continue" → "Continuer" makes text wrap
  // from 1 line to 2 (ratio = 2), so single-shot shrinks to 50%. But at
  // a smaller font the word fits on 1 line again. We grow back one point
  // at a time, checking each step, to find the largest size that still
  // fits within both height and width budgets.
  let growIterations = 0;
  while (current < originalFontSize && growIterations < SHRINK_MAX_GROW_ITERATIONS) {
    const tryNext = Math.min(originalFontSize, current + 1);
    if (tryNext === current) break;
    try {
      node.fontSize = tryNext;
    } catch {
      break;
    }
    if (
      node.height > originalHeight * OVERFLOW_TOLERANCE ||
      node.width > widthBudget * OVERFLOW_TOLERANCE
    ) {
      // Overflowed at the larger size — revert and stop.
      try {
        node.fontSize = current;
      } catch {}
      break;
    }
    current = tryNext;
    growIterations += 1;
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

  // Two-pass apply for uniform-shrink-across-the-selection.
  //
  // First pass: validate, fit each layer independently, record the natural
  // post-fit font size. Second pass: find the minimum shrink ratio across
  // the whole selection and apply that ratio uniformly so all layers shrink
  // by the same proportion. This preserves visual hierarchy when multiple
  // sibling layers (like a row of bullet items) get translated together
  // and some need more shrink than others.
  type Prepared = {
    nodeId: string;
    node: TextNode;
    original: OriginalSnapshot;
    naturalFinalSize: number;
  };
  const prepared: Prepared[] = [];

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

    const original = getOrCaptureOriginal(node);
    if (!original) {
      skipped.push({
        id: t.id,
        name: node.name,
        reason: 'cannot read original font size',
      });
      continue;
    }

    if (
      typeof node.fontSize === 'number' &&
      Math.abs(node.fontSize - original.fontSize) > 0.01
    ) {
      try {
        node.fontSize = original.fontSize;
      } catch {}
    }

    if (node.textAutoResize !== 'HEIGHT') {
      node.textAutoResize = 'HEIGHT';
    }
    if (Math.abs(node.width - original.width) > 0.5) {
      try {
        node.resize(original.width, node.height);
      } catch {}
    }

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

    // Fit this layer independently for now — second pass will apply
    // uniform shrink if any sibling needed more.
    let naturalFinalSize = original.fontSize;
    if (node.height > original.height * OVERFLOW_TOLERANCE) {
      naturalFinalSize = shrinkToFit(
        node,
        original.height,
        original.width,
        original.fontSize,
      );
    }

    prepared.push({ nodeId: t.id, node, original, naturalFinalSize });
  }

  // Second pass: cluster prepared layers by original font size and apply
  // uniform shrink WITHIN each cluster. Layers within 15% of each other
  // are treated as siblings (e.g. a row of bullets at 24pt); layers more
  // than 15% apart are treated as different hierarchy levels (e.g. a 60pt
  // headline + a 20pt tagline — different clusters, each scaled
  // independently). This preserves visual consistency for siblings while
  // not crushing a tagline just because a headline needed to shrink.
  const CLUSTER_TOLERANCE = 0.15;
  const sortedPrepared = [...prepared].sort(
    (a, b) => a.original.fontSize - b.original.fontSize,
  );
  const clusters: Prepared[][] = [];
  for (const p of sortedPrepared) {
    const lastCluster = clusters[clusters.length - 1];
    if (lastCluster) {
      const ref = lastCluster[0]!.original.fontSize;
      const diff = Math.abs(p.original.fontSize - ref) / ref;
      if (diff <= CLUSTER_TOLERANCE) {
        lastCluster.push(p);
        continue;
      }
    }
    clusters.push([p]);
  }

  for (const cluster of clusters) {
    const clusterMinRatio = Math.min(
      ...cluster.map((p) => p.naturalFinalSize / p.original.fontSize),
    );

    for (const p of cluster) {
      const uniformSize = p.original.fontSize * clusterMinRatio;
      if (uniformSize < p.naturalFinalSize - 0.1) {
        try {
          p.node.fontSize = uniformSize;
        } catch {}
      }

      const finalSize = Math.min(p.naturalFinalSize, uniformSize);
      if (finalSize < p.original.fontSize - 0.01) {
        shrunk.push({
          id: p.nodeId,
          name: p.node.name,
          from: p.original.fontSize,
          to: finalSize,
        });
      }

      // Lock dimensions: NONE mode at exact original dimensions. Wrap
      // computed during HEIGHT-mode apply is preserved.
      p.node.textAutoResize = 'NONE';
      try {
        p.node.resize(p.original.width, p.original.height);
      } catch {}
    }
  }

  const result: FromSandbox = {
    type: 'apply-result',
    translated: prepared.length,
    skipped,
    shrunk,
  };
  figma.ui.postMessage(result);
};
