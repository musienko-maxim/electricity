import { describe, it, expect } from 'vitest';
import { classifyEntry } from '../src/lib/pdf/classify';

describe('classifyEntry — known regressions', () => {
  it('extracts Дахнівська street numbers after ГДУ org (round-2 fix)', () => {
    const items = classifyEntry(
      'Бази відпочинку, ГДУ Держрибохорони в Черкаській області. вул. Дахнівська 1, 2/15, 2/17, 3, 5',
    );
    const numbers = items
      .filter((i) => i.kind === 'street_with_numbers' && i.streetName === 'Дахнівська')
      .map((i) => i.streetNumber);
    expect(numbers).toEqual(expect.arrayContaining(['1', '2/15', '2/17', '3', '5']));
  });

  it('round-1: б-р. Шевченка 411 is recognized as a bulvar street', () => {
    const items = classifyEntry('б-р. Шевченка 411');
    const hit = items.find((i) => i.streetName === 'Шевченка' && i.streetNumber === '411');
    expect(hit).toBeDefined();
    expect(hit?.displayName).toMatch(/^бул\.\s+Шевченка\s+411$/);
  });

  it('round-1: прс. Хіміків 61 normalizes prefix to просп., not пров.', () => {
    const items = classifyEntry('прс. Хіміків 61');
    const hit = items.find((i) => i.streetName === 'Хіміків' && i.streetNumber === '61');
    expect(hit?.displayName).toMatch(/^просп\.\s+Хіміків\s+61$/);
  });

  // BUG: extractEntities does not have splitCommas' odd-quote-count fallback.
  // An unbalanced `"` inside an entity chunk swallows trailing entities into
  // one bloated item.
  it('unbalanced-quote chunk: splits into TWO orgs, not one bundled item', () => {
    const items = classifyEntry(
      'СТОВ "Шрамкiвський молочно-тваринницький комплекс, Драбiвська рай.держ.лiкарня ветеринарної медицини',
    );
    const orgs = items.filter((i) => i.kind === 'organization');
    // Without the fix, this returns 1 bloated item. With the fix, 2.
    expect(orgs.length).toBeGreaterThanOrEqual(2);
    // First org should start with СТОВ; second with Драбiвська/Драбівська.
    expect(orgs.some((o) => /СТОВ/.test(o.displayName))).toBe(true);
    expect(orgs.some((o) => /Драб[іi]вська/.test(o.displayName))).toBe(true);
  });

  it('ORG_LEADING fallback: Парафія Успіння is an organization', () => {
    // From round-1 bugs. Currently dead code because ORG_LEADING_RE uses ASCII \b
    // which doesn't match Cyrillic — relies on final 3+ token fallback.
    const items = classifyEntry('Парафія Успіння Божої Матері Київської єпархії');
    const org = items.find((i) => i.kind === 'organization');
    expect(org).toBeDefined();
    expect(org?.displayName).toMatch(/^Парафія/);
  });
});
