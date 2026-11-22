import { DEFAULT_SETTINGS, type Bookmark, type Category, type Cover, type Settings } from './types';

const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export function openDatabase(name = 'save-library'): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('bookmarks')) {
        const s = db.createObjectStore('bookmarks', { keyPath: 'id' });
        s.createIndex('key', 'key');
        s.createIndex('savedAt', 'savedAt');
      }
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('captures')) db.createObjectStore('captures', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Database is open in another tab with an older version'));
  });
}

/**
 * Library store: IndexedDB is the source of truth; bookmarks/categories are mirrored in memory
 * so search and filtering are synchronous. Covers are loaded on demand.
 */
export class LibraryStore {
  bookmarks: Bookmark[] = []; // newest first
  categories: Category[] = [];
  settings: Settings = { ...DEFAULT_SETTINGS };
  private keys = new Map<string, string>(); // dedup key -> id
  private listeners = new Set<() => void>();

  private constructor(private db: IDBDatabase) {}

  static async open(name?: string): Promise<LibraryStore> {
    const s = new LibraryStore(await openDatabase(name));
    await s.reload();
    return s;
  }

  close(): void {
    this.db.close();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  async reload(): Promise<void> {
    const tx = this.db.transaction(['bookmarks', 'categories', 'settings'], 'readonly');
    const [bookmarks, categories, settingsVal] = await Promise.all([
      req(tx.objectStore('bookmarks').getAll() as IDBRequest<Bookmark[]>),
      req(tx.objectStore('categories').getAll() as IDBRequest<Category[]>),
      req(tx.objectStore('settings').get('settings') as IDBRequest<Partial<Settings> | undefined>),
    ]);
    this.bookmarks = bookmarks.sort((a, b) => b.savedAt - a.savedAt);
    this.categories = categories.sort((a, b) => a.name.localeCompare(b.name));
    this.settings = { ...DEFAULT_SETTINGS, ...(settingsVal ?? {}) };
    this.keys = new Map(this.bookmarks.map((b) => [b.key, b.id]));
  }

  hasKey(key: string): boolean {
    return this.keys.has(key);
  }

  keySet(): Set<string> {
    return new Set(this.keys.keys());
  }

  get(id: string): Bookmark | undefined {
    return this.bookmarks.find((b) => b.id === id);
  }

  /** Adds bookmarks (skipping keys that already exist). Returns those actually added. */
  async addBookmarks(
    list: Bookmark[],
    opts: { captureIds?: string[]; categories?: Category[]; covers?: Map<string, Omit<Cover, 'id'>> } = {},
  ): Promise<Bookmark[]> {
    const batch = new Set<string>();
    const added = list.filter((b) => {
      if (this.keys.has(b.key) || batch.has(b.key)) return false;
      batch.add(b.key);
      return true;
    });
    const addedIds = new Set(added.map((b) => b.id));
    const tx = this.db.transaction(['bookmarks', 'captures', 'categories', 'covers'], 'readwrite');
    const bs = tx.objectStore('bookmarks');
    for (const b of added) bs.put(b);
    for (const c of opts.categories ?? []) tx.objectStore('categories').put(c);
    for (const [id, cv] of opts.covers ?? []) {
      if (addedIds.has(id)) tx.objectStore('covers').put({ id, ...cv });
    }
    const now = Date.now();
    for (const id of opts.captureIds ?? []) tx.objectStore('captures').put({ id, importedAt: now });
    await done(tx);
    for (const b of added) this.keys.set(b.key, b.id);
    if (opts.categories?.length) {
      this.categories = [...this.categories, ...opts.categories].sort((a, b) => a.name.localeCompare(b.name));
    }
    this.bookmarks = [...added, ...this.bookmarks].sort((a, b) => b.savedAt - a.savedAt);
    this.emit();
    return added;
  }

  async updateBookmark(id: string, patch: Partial<Omit<Bookmark, 'id' | 'url' | 'key'>>): Promise<Bookmark> {
    const cur = this.get(id);
    if (!cur) throw new Error('Bookmark not found');
    const next: Bookmark = { ...cur, ...patch, id: cur.id, url: cur.url, key: cur.key, updatedAt: Date.now() };
    const tx = this.db.transaction('bookmarks', 'readwrite');
    tx.objectStore('bookmarks').put(next);
    await done(tx);
    this.bookmarks = this.bookmarks.map((b) => (b.id === id ? next : b));
    this.emit();
    return next;
  }

  async deleteBookmark(id: string): Promise<void> {
    const cur = this.get(id);
    const tx = this.db.transaction(['bookmarks', 'covers'], 'readwrite');
    tx.objectStore('bookmarks').delete(id);
    tx.objectStore('covers').delete(id);
    await done(tx);
    if (cur) this.keys.delete(cur.key);
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this.emit();
  }

  async putCover(cover: Cover): Promise<void> {
    const cur = this.get(cover.id);
    if (!cur) throw new Error('Bookmark not found');
    const next = { ...cur, hasCover: true, updatedAt: Date.now() };
    const tx = this.db.transaction(['covers', 'bookmarks'], 'readwrite');
    tx.objectStore('covers').put(cover);
    tx.objectStore('bookmarks').put(next);
    await done(tx);
    this.bookmarks = this.bookmarks.map((b) => (b.id === cover.id ? next : b));
    this.emit();
  }

  async getCover(id: string): Promise<Cover | undefined> {
    const tx = this.db.transaction('covers', 'readonly');
    return req(tx.objectStore('covers').get(id) as IDBRequest<Cover | undefined>);
  }

  async allCovers(): Promise<Cover[]> {
    const tx = this.db.transaction('covers', 'readonly');
    return req(tx.objectStore('covers').getAll() as IDBRequest<Cover[]>);
  }

  async removeCover(id: string): Promise<void> {
    const cur = this.get(id);
    if (!cur) return;
    const next = { ...cur, hasCover: false, updatedAt: Date.now() };
    const tx = this.db.transaction(['covers', 'bookmarks'], 'readwrite');
    tx.objectStore('covers').delete(id);
    tx.objectStore('bookmarks').put(next);
    await done(tx);
    this.bookmarks = this.bookmarks.map((b) => (b.id === id ? next : b));
    this.emit();
  }

  async addCategory(name: string): Promise<Category> {
    const existing = this.categories.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing;
    const c: Category = {
      id: (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)),
      name: name.trim(),
      createdAt: Date.now(),
    };
    const tx = this.db.transaction('categories', 'readwrite');
    tx.objectStore('categories').put(c);
    await done(tx);
    this.categories = [...this.categories, c].sort((a, b) => a.name.localeCompare(b.name));
    this.emit();
    return c;
  }

  async renameCategory(id: string, name: string): Promise<void> {
    const cur = this.categories.find((c) => c.id === id);
    if (!cur) return;
    const next = { ...cur, name: name.trim() };
    const tx = this.db.transaction('categories', 'readwrite');
    tx.objectStore('categories').put(next);
    await done(tx);
    this.categories = this.categories.map((c) => (c.id === id ? next : c)).sort((a, b) => a.name.localeCompare(b.name));
    this.emit();
  }

  /** Deleting a category returns its bookmarks to the Inbox (atomically). */
  async deleteCategory(id: string): Promise<void> {
    const now = Date.now();
    const moved = this.bookmarks.filter((b) => b.categoryId === id).map((b) => ({ ...b, categoryId: null, updatedAt: now }));
    const tx = this.db.transaction(['categories', 'bookmarks'], 'readwrite');
    tx.objectStore('categories').delete(id);
    for (const b of moved) tx.objectStore('bookmarks').put(b);
    await done(tx);
    const m = new Map(moved.map((b) => [b.id, b]));
    this.bookmarks = this.bookmarks.map((b) => m.get(b.id) ?? b);
    this.categories = this.categories.filter((c) => c.id !== id);
    this.emit();
  }

  async saveSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    const tx = this.db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put(this.settings, 'settings');
    await done(tx);
    this.emit();
  }

  async importedCaptureIds(ids: string[]): Promise<Set<string>> {
    const tx = this.db.transaction('captures', 'readonly');
    const store = tx.objectStore('captures');
    const found = await Promise.all(ids.map((id) => req(store.getKey(id))));
    return new Set(ids.filter((_, i) => found[i] !== undefined));
  }
}
