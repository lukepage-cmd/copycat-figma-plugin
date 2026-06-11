export type SelectionItem = {
  id: string;
  name: string;
  characters: string;
  skipReason: SkipReason | null;
};

export type SkipReason = 'mixed-styling' | 'layer-locked' | 'empty-text';

export type SkipDetail = { id: string; name: string; reason: string };

/** A text node whose font size was reduced after translation to keep it inside its original bounding box. */
export type ShrunkDetail = { id: string; name: string; from: number; to: number };

export type FromSandbox =
  | { type: 'selection'; items: SelectionItem[] }
  | {
      type: 'apply-result';
      translated: number;
      skipped: SkipDetail[];
      shrunk: ShrunkDetail[];
    }
  | { type: 'apply-error'; message: string };

export type ToSandbox =
  | { type: 'apply'; translations: { id: string; text: string }[] }
  | { type: 'resize'; height: number }
  | { type: 'close' };
