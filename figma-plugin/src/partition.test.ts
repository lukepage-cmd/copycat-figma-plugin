import { describe, it, expect } from 'vitest';
import { partitionSelection, type RawNode } from './partition';

const base = (over: Partial<RawNode>): RawNode => ({
  id: 'x',
  name: 'x',
  characters: 'hello',
  locked: false,
  hasMixedFontName: false,
  hasMixedFills: false,
  hasMixedFontSize: false,
  ...over,
});

describe('partitionSelection', () => {
  it('marks a plain text node as translatable', () => {
    const result = partitionSelection([base({ id: '1', characters: 'Hello' })]);
    expect(result).toEqual([
      { id: '1', name: 'x', characters: 'Hello', skipReason: null },
    ]);
  });

  it('marks a locked layer as skipped', () => {
    const result = partitionSelection([base({ id: '1', locked: true })]);
    expect(result[0]!.skipReason).toBe('layer-locked');
  });

  it('marks mixed-font nodes as skipped', () => {
    const result = partitionSelection([base({ id: '1', hasMixedFontName: true })]);
    expect(result[0]!.skipReason).toBe('mixed-styling');
  });

  it('marks mixed-fills as skipped (style includes colour)', () => {
    const result = partitionSelection([base({ id: '1', hasMixedFills: true })]);
    expect(result[0]!.skipReason).toBe('mixed-styling');
  });

  it('marks mixed-size as skipped', () => {
    const result = partitionSelection([base({ id: '1', hasMixedFontSize: true })]);
    expect(result[0]!.skipReason).toBe('mixed-styling');
  });

  it('marks empty text as skipped', () => {
    const result = partitionSelection([base({ id: '1', characters: '   ' })]);
    expect(result[0]!.skipReason).toBe('empty-text');
  });

  it('locked beats mixed-styling in the reason field', () => {
    const result = partitionSelection([
      base({ id: '1', locked: true, hasMixedFontName: true }),
    ]);
    expect(result[0]!.skipReason).toBe('layer-locked');
  });
});
