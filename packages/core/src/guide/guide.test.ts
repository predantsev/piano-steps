import { describe, expect, it } from 'vitest';
import { BUNDLED_GUIDES } from './guide.ts';

describe('bundled guides', () => {
  it('exist for every UI language with the same sections in the same order', () => {
    expect(Object.keys(BUNDLED_GUIDES).sort()).toEqual(['en', 'uk']);
    const ids = (lang: string) => BUNDLED_GUIDES[lang].sections.map((s) => s.id);
    expect(ids('uk')).toEqual(ids('en'));
    for (const g of Object.values(BUNDLED_GUIDES)) for (const s of g.sections) expect(s.body.length).toBeGreaterThan(0);
  });
});
