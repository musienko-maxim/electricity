import { describe, it, expect } from 'vitest';
import { joinChunksToLine } from '../src/lib/pdf/extract';

// BUG #9: chunk fusion when gap ≤ 1pt drops the word boundary between adjacent
// letter-letter chunks like "ТОВ" + "Лани" → "ТОВЛани", which then fails the
// ENTITY_PREFIX_RE word-end lookahead.

describe('joinChunksToLine', () => {
  it('inserts a space between adjacent letter chunks even when x-gap is tiny', () => {
    // Two chunks reported by pdfjs as abutting (gap = 0.5pt).
    const text = joinChunksToLine([
      { x: 100, str: 'ТОВ', width: 20 },     // ends at x=120
      { x: 120.5, str: 'Лани', width: 25 }, // gap = 0.5pt
    ]);
    expect(text).toBe('ТОВ Лани');
  });

  it('does NOT insert a space when a chunk ends in space or starts with punctuation', () => {
    const text = joinChunksToLine([
      { x: 100, str: 'foo ', width: 20 }, // already has trailing space
      { x: 120.5, str: 'bar', width: 25 },
    ]);
    expect(text.replace(/\s+/g, ' ')).toBe('foo bar');
  });

  it('still inserts a space for clearly separated chunks (gap > 1pt)', () => {
    const text = joinChunksToLine([
      { x: 100, str: 'one', width: 20 },
      { x: 130, str: 'two', width: 20 }, // gap = 10pt
    ]);
    expect(text).toBe('one two');
  });
});
