import { describe, expect, it } from 'vitest';
import { suggestCategory } from '../src/lib/suggest';
import type { Category } from '../src/lib/types';

const b = (o: { title?: string; sharedText?: string; note?: string; tags?: string[] }) => ({ tags: [], ...o });
const cats: Category[] = [
  { id: 's', name: 'Sewing', createdAt: 1 },
  { id: 'r', name: 'Recipes', createdAt: 1 },
  { id: 'k', name: 'Kids party', createdAt: 1 },
];

describe('category suggestions', () => {
  it('suggests an existing category from English keywords', () => {
    expect(suggestCategory(b({ sharedText: 'Easy tote bag sewing tutorial 🧵' }), cats)).toMatchObject({ kind: 'existing', categoryId: 's' });
    expect(suggestCategory(b({ sharedText: 'Best chocolate cake ever #baking' }), cats)).toMatchObject({ kind: 'existing', categoryId: 'r' });
  });
  it('maps Hebrew text to an English-named category via the concept lexicon', () => {
    expect(suggestCategory(b({ sharedText: 'מתכון לעוגת שוקולד בלי אפייה' }), cats)).toMatchObject({ categoryId: 'r' });
    expect(suggestCategory(b({ sharedText: 'איך לתפור תיק בד' }), cats)).toMatchObject({ categoryId: 's' });
  });
  it('matches user category names (no built-in concept)', () => {
    expect(suggestCategory(b({ note: 'ideas for the kids party' }), cats)).toMatchObject({ categoryId: 'k' });
  });
  it('matches a Hebrew user category name', () => {
    const he: Category[] = [{ id: 'h', name: 'מתכונים', createdAt: 1 }];
    expect(suggestCategory(b({ sharedText: 'Quick dinner recipe' }), he)).toMatchObject({ categoryId: 'h' });
  });
  it('suggests creating a new category when none fits, in the text language', () => {
    expect(suggestCategory(b({ sharedText: 'Fabric quilt pattern' }), [])).toMatchObject({ kind: 'new', name: 'Sewing' });
    expect(suggestCategory(b({ sharedText: 'מתכון לחלה' }), [])).toMatchObject({ kind: 'new', name: 'מתכונים' });
  });
  it('falls back to no suggestion for opaque links or unrelated text', () => {
    expect(suggestCategory(b({}), cats)).toBeNull();
    expect(suggestCategory(b({ sharedText: 'https://vm.tiktok.com/ZS1/' }), cats)).toBeNull();
    expect(suggestCategory(b({ sharedText: 'lol 😂' }), cats)).toBeNull();
  });
  it('uses tags (hashtags) too', () => {
    expect(suggestCategory(b({ tags: ['#embroidery'] }), cats)).toMatchObject({ categoryId: 's' });
  });
});
