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

  // STEP 2: full-form street prefixes ("Проспект", "Вулиця", "Бульвар",
  // "Площа", "Провулок") now terminate entity ranges and seed parseStreetChunk.
  it('full-form Проспект splits ТОВ from street+number', () => {
    const items = classifyEntry('ТОВ "СКЛО-СЕРВІС" Проспект Хіміків 82');
    const orgs = items.filter((i) => i.kind === 'organization');
    const streets = items.filter((i) => i.kind === 'street_with_numbers');
    expect(orgs.some((o) => /СКЛО-СЕРВІС/.test(o.displayName))).toBe(true);
    expect(
      streets.some((s) => s.streetName === 'Хіміків' && s.streetNumber === '82'),
    ).toBe(true);
  });

  it('full-form Вулиця recognized as street prefix', () => {
    const items = classifyEntry('Вулиця Шевченка 1, 3, 5');
    const hits = items.filter(
      (i) => i.kind === 'street_with_numbers' && i.streetName === 'Шевченка',
    );
    expect(hits.map((h) => h.streetNumber)).toEqual(
      expect.arrayContaining(['1', '3', '5']),
    );
    // Normalized to abbreviated form for consistent display.
    expect(hits[0].displayName).toMatch(/^вул\.\s+Шевченка/);
  });

  it('full-form Бульвар Шевченка 411 — display normalized to short form', () => {
    const items = classifyEntry('Бульвар Шевченка 411');
    const hit = items.find(
      (i) => i.streetName === 'Шевченка' && i.streetNumber === '411',
    );
    expect(hit?.displayName).toMatch(/^бул\.\s+Шевченка\s+411$/);
  });

  it('Проспект-Будсервіс (hyphenated org) does NOT trigger street split', () => {
    // Hyphen after "Проспект" must keep the full-form lookahead inactive so
    // a hyphenated org name doesn't get misread as a street prefix.
    const items = classifyEntry('ТОВ "Проспект-Будсервіс"');
    const streets = items.filter((i) => i.kind.startsWith('street'));
    expect(streets).toHaveLength(0);
  });

  // STEP 2: ENTITY_PREFIXES extended from 12-PDF audit.
  it('ГДУ Держрибохорони is classified as organization (direct prefix)', () => {
    const items = classifyEntry('ГДУ Держрибохорони в Черкаській області');
    const org = items.find((i) => i.kind === 'organization');
    expect(org?.displayName).toMatch(/^ГДУ\s+Держрибохорони/);
  });

  it('ВП "Промислові системи" classified as organization', () => {
    const items = classifyEntry('ВП "Промислові системи"');
    expect(items.some((i) => i.kind === 'organization' && /Промислові системи/.test(i.displayName))).toBe(true);
  });
});
