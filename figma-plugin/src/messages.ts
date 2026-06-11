export type SelectionItem = {
  id: string;
  name: string;
  characters: string;
  skipReason: SkipReason | null;
};

export type SkipReason = 'mixed-styling' | 'layer-locked' | 'empty-text';

export type SkipDetail = { id: string; name: string; reason: string };

export type FromSandbox =
  | { type: 'selection'; items: SelectionItem[] }
  | { type: 'apply-result'; translated: number; skipped: SkipDetail[] }
  | { type: 'apply-error'; message: string };

export type ToSandbox =
  | { type: 'apply'; translations: { id: string; text: string }[] }
  | { type: 'close' };
