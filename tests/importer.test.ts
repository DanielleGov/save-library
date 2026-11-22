import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  capturesToCandidates,
  encodeDataUrl,
  isCapture,
  parseBackup,
  parseBulkText,
  parseCaptureFile,
  planImport,
  planRestore,
  type BackupFile,
} from '../src/lib/importer';
import type { Bookmark } from '../src/lib/types';

const dir = join(__dirname, '..', 'fixtures', 'shortcut-inbox');
const files = readdirSync(dir).map((f) => ({ name: f, content: readFileSync(join(dir, f), 'utf8') }));

describe('Shortcut capture files (fixtures)', () => {
  const parsed = files.map((f) => parseCaptureFile(f.name, f.content));
  const caps = parsed.filter(isCapture);
  const problems = parsed.filter((p) => !isCapture(p));

  it('parses valid captures, including plain text fallback', () => {
    expect(caps.map((c) => c.fileName).sort()).toEqual([
      'capture-20261122-101500-4821.json',
      'capture-20261122-101730-0193.json',
      'capture-20261122-102000-7777.json',
      'capture-plain-text.txt',
    ]);
    const multi = caps.find((c) => c.id === '20261122-102000-7777')!;
    expect(multi.urls).toEqual(['https://www.facebook.com/share/r/SYNTHETIC2/', 'https://www.youtube.com/shorts/aaaaaaaaaaa']);
    expect(multi.createdAt).toBe(Date.parse('2026-11-22T10:20:00+02:00'));
  });

  it('reports no-link and invalid-only captures', () => {
    expect(problems.map((p) => p.fileName).sort()).toEqual(['capture-bad-url.json', 'capture-no-link.json']);
  });

  it('keeps shared text but not the duplicated URL', () => {
    const cands = capturesToCandidates(caps);
    const ig = cands.find((c) => c.info.platform === 'instagram')!;
    expect(ig.sharedText).toBe('Easy tote bag sewing tutorial 🧵');
    const tt = cands.find((c) => c.info.platform === 'tiktok')!;
    expect(tt.sharedText).toContain('מתכון');
  });

  it('dedupes repeated imports of the same captures', () => {
    const cands = capturesToCandidates(caps);
    const first = planImport(cands, new Set(), 'shortcut');
    expect(first.toAdd.length).toBe(5);
    const again = planImport(capturesToCandidates(caps), new Set(first.toAdd.map((b) => b.key)), 'shortcut');
    expect(again.toAdd.length).toBe(0);
    expect(again.duplicates).toBe(5);
  });

  it('dedupes within one batch (same reel shared twice with different tracking)', () => {
    const a = parseCaptureFile('a.json', JSON.stringify({ format: 'save-library-capture', v: 1, urls: 'https://www.instagram.com/reel/X1/?igsh=1' }));
    const b = parseCaptureFile('b.json', JSON.stringify({ format: 'save-library-capture', v: 1, urls: ['https://instagram.com/reels/X1'] }));
    const plan = planImport(capturesToCandidates([a, b].filter(isCapture)), new Set(), 'shortcut');
    expect(plan.toAdd.length).toBe(1);
    expect(plan.duplicates).toBe(1);
  });

  it('rejects oversized, malformed, future-version and backup files', () => {
    expect(isCapture(parseCaptureFile('big.json', 'x'.repeat(70_000)))).toBe(false);
    expect(isCapture(parseCaptureFile('bad.json', '{ not json'))).toBe(false);
    expect(isCapture(parseCaptureFile('v9.json', '{"format":"save-library-capture","v":9,"urls":"https://a.com"}'))).toBe(false);
    expect(isCapture(parseCaptureFile('b.json', '{"format":"save-library-backup","version":2}'))).toBe(false);
  });

  it('derives a stable id when the file has none', () => {
    const c1 = parseCaptureFile('x.txt', 'hi https://a.com/1');
    const c2 = parseCaptureFile('y.txt', 'hi https://a.com/1');
    expect(isCapture(c1) && isCapture(c2) && c1.id === c2.id).toBe(true);
  });
});

describe('bulk paste', () => {
  it('extracts one candidate per link with per-line text and counts invalid', () => {
    const r = parseBulkText(
      'Bread recipe https://example.com/bread\nhttps://youtu.be/dQw4w9WgXcQ\nnot a link\nhttps://u:p@bad.com/ oops\n',
    );
    expect(r.candidates.map((c) => c.info.url)).toEqual(['https://example.com/bread', 'https://youtu.be/dQw4w9WgXcQ']);
    expect(r.candidates[0]!.sharedText).toBe('Bread recipe');
    expect(r.invalid).toBe(1);
  });
});

describe('backup / restore', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).buffer;
  const bm = (o: Partial<Bookmark>): Bookmark => ({
    id: 'b1', url: 'https://www.instagram.com/reel/SYN9/', key: 'instagram:SYN9', platform: 'instagram',
    mediaType: 'reel', savedAt: 1_700_000_000_000, updatedAt: 1, tags: ['sewing'], categoryId: 'c1', source: 'manual', ...o,
  });
  const backup: BackupFile = {
    format: BACKUP_FORMAT, version: 2, exportedAt: '2026-11-22T00:00:00Z',
    categories: [{ id: 'c1', name: 'Sewing', createdAt: 1 }],
    bookmarks: [
      bm({ title: 'Tote', note: 'line it', hasCover: true }),
      bm({ id: 'b2', url: 'javascript:alert(1)' }),
      bm({ id: 'b3', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', mediaType: 'post', mediaTypeEdited: false, categoryId: 'missing' }),
    ],
    covers: { b1: { dataUrl: encodeDataUrl('image/jpeg', jpeg), width: 10, height: 10 } },
  };

  it('round-trips through JSON with covers, revalidating everything', () => {
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const plan = planRestore(parsed.backup, new Set(), []);
    expect(plan.toAdd.length).toBe(2);
    expect(plan.invalid).toBe(1);
    const tote = plan.toAdd.find((b) => b.title === 'Tote')!;
    expect(tote.categoryId).toBe('c1');
    expect(tote.hasCover).toBe(true);
    expect(plan.covers.get(tote.id)!.bytes.byteLength).toBe(8);
    const yt = plan.toAdd.find((b) => b.platform === 'youtube')!;
    expect(yt.mediaType).toBe('video'); // not user-edited → re-inferred
    expect(yt.categoryId).toBeNull(); // unknown category → Inbox
  });

  it('preserves existing annotations: duplicates are skipped, categories merged by name', () => {
    const parsed = parseBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error();
    const plan = planRestore(parsed.backup, new Set(['instagram:SYN9']), [{ id: 'local', name: 'sewing', createdAt: 1 }]);
    expect(plan.duplicates).toBe(1);
    expect(plan.categoriesToAdd).toEqual([]);
    expect(plan.categoryMap.get('c1')).toBe('local');
  });

  it('supports v1 backups without covers', () => {
    const v1 = { ...backup, version: 1, covers: undefined };
    const parsed = parseBackup(JSON.stringify(v1));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(planRestore(parsed.backup, new Set(), []).covers.size).toBe(0);
  });

  it('rejects unsafe covers and unknown formats/versions', () => {
    const bad = { ...backup, covers: { b1: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=', width: 1, height: 1 } } };
    const p = parseBackup(JSON.stringify(bad));
    if (!p.ok) throw new Error();
    const plan = planRestore(p.backup, new Set(), []);
    expect(plan.coversSkipped).toBe(1);
    expect(plan.toAdd.every((b) => !b.hasCover)).toBe(true);
    expect(parseBackup('{"format":"other"}').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ ...backup, version: 99 })).ok).toBe(false);
    expect(parseBackup('nope').ok).toBe(false);
  });
});
