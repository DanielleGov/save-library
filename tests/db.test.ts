import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LibraryStore } from '../src/lib/db';
import { capturesToCandidates, isCapture, parseCaptureFile, planImport } from '../src/lib/importer';
import { syntheticLibrary } from './synthetic';

let n = 0;
const dbName = () => `test-${++n}-${Math.random()}`;

describe('LibraryStore persistence', () => {
  it('persists bookmarks, edits, categories, covers and settings across reopen', async () => {
    const name = dbName();
    const s = await LibraryStore.open(name);
    const cap = parseCaptureFile('a.json', '{"format":"save-library-capture","v":1,"id":"cap1","urls":"https://www.instagram.com/reel/P1/","text":"Tote sewing"}');
    if (!isCapture(cap)) throw new Error();
    const plan = planImport(capturesToCandidates([cap]), s.keySet(), 'shortcut');
    const [added] = await s.addBookmarks(plan.toAdd, { captureIds: [cap.id] });
    const cat = await s.addCategory('Sewing');
    await s.updateBookmark(added!.id, { title: 'My tote', categoryId: cat.id, tags: ['bags'] });
    await s.putCover({ id: added!.id, type: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 1]).buffer, width: 3, height: 1 });
    await s.saveSettings({ view: 'grid', remoteThumbnails: true });
    s.close();

    const r = await LibraryStore.open(name);
    expect(r.bookmarks.length).toBe(1);
    expect(r.bookmarks[0]).toMatchObject({ title: 'My tote', categoryId: cat.id, tags: ['bags'], hasCover: true, sharedText: 'Tote sewing' });
    expect(r.categories.map((c) => c.name)).toEqual(['Sewing']);
    expect(r.settings).toEqual({ view: 'grid', remoteThumbnails: true });
    const cover = await r.getCover(added!.id);
    expect(new Uint8Array(cover!.bytes)[0]).toBe(0xff);
    expect(await r.importedCaptureIds(['cap1', 'other'])).toEqual(new Set(['cap1']));
    r.close();
  });

  it('never stores duplicate keys, even when called twice', async () => {
    const s = await LibraryStore.open(dbName());
    const lib = syntheticLibrary(3);
    await s.addBookmarks(lib);
    const again = await s.addBookmarks(lib.map((b) => ({ ...b, id: b.id + '-x' })));
    expect(again.length).toBe(0);
    expect(s.bookmarks.length).toBe(3);
    s.close();
  });

  it('deleting a category returns its bookmarks to the Inbox', async () => {
    const name = dbName();
    const s = await LibraryStore.open(name);
    await s.addBookmarks(syntheticLibrary(4));
    const c = await s.addCategory('Recipes');
    for (const b of s.bookmarks.slice(0, 2)) await s.updateBookmark(b.id, { categoryId: c.id });
    await s.deleteCategory(c.id);
    expect(s.bookmarks.every((b) => b.categoryId === null)).toBe(true);
    s.close();
    const r = await LibraryStore.open(name);
    expect(r.bookmarks.every((b) => b.categoryId === null)).toBe(true);
    expect(r.categories.length).toBe(0);
    r.close();
  });

  it('delete removes the bookmark and its cover; rename persists', async () => {
    const name = dbName();
    const s = await LibraryStore.open(name);
    const [b] = await s.addBookmarks(syntheticLibrary(1));
    await s.putCover({ id: b!.id, type: 'image/jpeg', bytes: new ArrayBuffer(2), width: 1, height: 1 });
    await s.deleteBookmark(b!.id);
    expect(await s.getCover(b!.id)).toBeUndefined();
    const c = await s.addCategory('Sew');
    await s.renameCategory(c.id, 'Sewing');
    s.close();
    const r = await LibraryStore.open(name);
    expect(r.bookmarks.length).toBe(0);
    expect(r.categories[0]!.name).toBe('Sewing');
    r.close();
  });

  it('loads 3,000 bookmarks newest first', async () => {
    const name = dbName();
    const s = await LibraryStore.open(name);
    await s.addBookmarks(syntheticLibrary(3000).reverse());
    s.close();
    const r = await LibraryStore.open(name);
    expect(r.bookmarks.length).toBe(3000);
    expect(r.bookmarks[0]!.id).toBe('syn-0');
    r.close();
  });
});
