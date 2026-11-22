import { normalize } from './text';
import { MEDIA_LABELS, PLATFORM_LABELS, type Bookmark, type Category, type MediaType, type Platform } from './types';
import { displayUrl } from './url';

export interface Filters {
  query: string;
  platform: Platform | '';
  mediaType: MediaType | '';
  /** '' = any, 'inbox' = uncategorized, otherwise a category id */
  category: string;
  coverOnly?: boolean;
}

export const EMPTY_FILTERS: Filters = { query: '', platform: '', mediaType: '', category: '' };

/** Builds the searchable text from what the app actually has — no fetched page content. */
export function haystack(b: Bookmark, categoryName?: string): string {
  return normalize(
    [
      b.title,
      b.sharedText,
      b.note,
      b.tags.join(' '),
      categoryName,
      displayUrl(b.url),
      PLATFORM_LABELS[b.platform],
      MEDIA_LABELS[b.mediaType],
    ]
      .filter(Boolean)
      .join(' \n '),
  );
}

export class SearchIndex {
  private cache = new Map<string, string>();
  constructor(private categoryName: (id: string | null) => string | undefined) {}

  text(b: Bookmark): string {
    let h = this.cache.get(b.id);
    if (h === undefined) {
      h = haystack(b, this.categoryName(b.categoryId));
      this.cache.set(b.id, h);
    }
    return h;
  }

  invalidate(id?: string): void {
    if (id) this.cache.delete(id);
    else this.cache.clear();
  }
}

/** Filter + search. `list` must already be newest-first; order is preserved. */
export function searchBookmarks(list: Bookmark[], f: Filters, index: SearchIndex): Bookmark[] {
  const tokens = normalize(f.query).split(' ').filter(Boolean);
  return list.filter((b) => {
    if (f.platform && b.platform !== f.platform) return false;
    if (f.mediaType && b.mediaType !== f.mediaType) return false;
    if (f.category === 'inbox' ? b.categoryId !== null : f.category && b.categoryId !== f.category) return false;
    if (f.coverOnly && !b.hasCover) return false;
    if (!tokens.length) return true;
    const h = index.text(b);
    return tokens.every((t) => h.includes(t));
  });
}

export function categoryNameLookup(categories: Category[]): (id: string | null) => string | undefined {
  const m = new Map(categories.map((c) => [c.id, c.name]));
  return (id) => (id ? m.get(id) : undefined);
}
