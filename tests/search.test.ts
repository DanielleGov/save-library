import { describe, expect, it } from 'vitest';
import { categoryNameLookup, searchBookmarks, SearchIndex, EMPTY_FILTERS } from '../src/lib/search';
import { normalize } from '../src/lib/text';
import type { Bookmark, Category } from '../src/lib/types';
import { syntheticLibrary } from './synthetic';

const cats: Category[] = [
  { id: 'c-sew', name: 'Sewing', createdAt: 1 },
  { id: 'c-rec', name: 'מתכונים', createdAt: 1 },
];
const mk = (o: Partial<Bookmark>): Bookmark => ({
  id: Math.random().toString(36), url: 'https://example.com/x', key: Math.random().toString(36), platform: 'other',
  mediaType: 'unknown', savedAt: 1, updatedAt: 1, tags: [], categoryId: null, source: 'manual', ...o,
});
const list = [
  mk({ title: 'Tote bag tutorial', categoryId: 'c-sew', platform: 'instagram', mediaType: 'reel', url: 'https://www.instagram.com/reel/A/' }),
  mk({ sharedText: 'מתכון לעוגת שוקולד', categoryId: 'c-rec', platform: 'tiktok', mediaType: 'video' }),
  mk({ note: 'Mixed טקסט with English and עברית', tags: ['ideas'] }),
  mk({ title: 'Crème brûlée', platform: 'youtube', mediaType: 'short' }),
];
const idx = () => new SearchIndex(categoryNameLookup(cats));
const q = (query: string, extra = {}) => searchBookmarks(list, { ...EMPTY_FILTERS, query, ...extra }, idx());

describe('normalize', () => {
  it('strips niqqud and unifies Hebrew final letters', () => {
    expect(normalize('שָׁלוֹם')).toBe('שלומ');
    expect(normalize('מתכון')).toBe('מתכונ');
  });
  it('strips Latin diacritics and bidi marks', () => {
    expect(normalize('‏Crème Brûlée')).toBe('creme brulee');
  });
});

describe('search', () => {
  it('finds English text in titles, case-insensitively', () => expect(q('TOTE').length).toBe(1));
  it('finds Hebrew substrings across final-letter forms', () => {
    expect(q('מתכון').length).toBe(1); // matches "מתכון" and the category "מתכונים"
    expect(q('מתכונים').length).toBe(1); // category name
  });
  it('matches mixed Hebrew/English with AND semantics', () => {
    expect(q('english עברית').length).toBe(1);
    expect(q('english שוקולד').length).toBe(0);
  });
  it('searches category names, platform and media labels and URL text', () => {
    expect(q('sewing').length).toBe(1);
    expect(q('reel').length).toBe(1);
    expect(q('instagram.com').length).toBe(1);
  });
  it('ignores diacritics in queries', () => expect(q('creme').length).toBe(1));
  it('combines filters', () => {
    expect(q('', { platform: 'tiktok' }).length).toBe(1);
    expect(q('', { category: 'inbox' }).length).toBe(2);
    expect(q('', { platform: 'youtube', mediaType: 'short' }).length).toBe(1);
    expect(q('tote', { platform: 'youtube' }).length).toBe(0);
  });
  it('stays fast on 5,000 bookmarks', () => {
    const big = syntheticLibrary(5000);
    const index = new SearchIndex(() => undefined);
    searchBookmarks(big, { ...EMPTY_FILTERS, query: 'warm' }, index); // build cache
    const t0 = performance.now();
    for (const query of ['sewing', 'מתכון', 'reel tote', 'zzz']) searchBookmarks(big, { ...EMPTY_FILTERS, query }, index);
    const per = (performance.now() - t0) / 4;
    expect(per).toBeLessThan(50);
  });
});
