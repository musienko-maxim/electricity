import { describe, it, expect } from 'vitest';
import { buildFtsPrefixQuery, normalizeText } from '../src/lib/normalize';

describe('normalizeText', () => {
  it('lowercases and expands вул./вулиця to canonical вул.', () => {
    expect(normalizeText('Вулиця Шевченка 5')).toBe('вул. шевченка 5');
    expect(normalizeText('вул. Шевченка 5')).toBe('вул. шевченка 5');
  });

  it('normalizes curly quotes/apostrophes', () => {
    expect(normalizeText('ТОВ «Лани»')).toBe('тов "лани"');
  });
});

describe('buildFtsPrefixQuery', () => {
  it('splits on whitespace and adds * to the last token', () => {
    expect(buildFtsPrefixQuery('вул шевченка')).toBe('"вул" "шевченка"*');
  });

  // FTS5 unicode61 treats `.` as a separator; a token like "рай.держ" with an
  // embedded period matches nothing. Split on `.` so each side is its own token.
  it('splits on dot so prefix queries with abbreviation periods work', () => {
    const q = buildFtsPrefixQuery('рай.держ');
    // Must produce two FTS tokens, neither containing a literal `.`.
    expect(q).not.toMatch(/[а-я]\.[а-я]/iu);
    expect(q.split(/\s+/)).toHaveLength(2);
    // Last token gets the prefix asterisk.
    expect(q).toMatch(/\*$/);
  });

  it('handles trailing dot from "вул." prefix correctly', () => {
    const q = buildFtsPrefixQuery('вул.');
    // "вул" + "*" — the trailing empty token after split should not produce `""*`.
    expect(q).not.toContain('""');
  });
});
