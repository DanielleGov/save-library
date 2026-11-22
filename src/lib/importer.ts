import { cleanTags, cleanText, uid } from './text';
import { LIMITS, MEDIA_TYPES, type Bookmark, type BookmarkSource, type Category, type MediaType } from './types';
import { analyzeLink, extractUrls, textWithoutUrls, type LinkInfo } from './url';

/* ------------------------------------------------------------------ */
/* Shortcut capture files                                              */
/* ------------------------------------------------------------------ */

export const CAPTURE_FORMAT = 'save-library-capture';
export const CAPTURE_VERSION = 1;

/**
 * One capture file written by the "Save to Library" Shortcut:
 * { "format": "save-library-capture", "v": 1, "id": "...", "createdAt": "2026-11-22T10:00:00+02:00",
 *   "urls": "https://...\nhttps://..." | ["https://..."], "text": "optional shared text" }
 * Plain .txt files containing links are accepted as a fallback.
 */
export interface Capture {
  /** Stable id for repeat-import detection (from the file, else derived from its content). */
  id: string;
  fileName: string;
  createdAt: number | null;
  urls: string[];
  text: string;
  invalid: number;
}

export interface FileProblem {
  fileName: string;
  reason: string;
}

function hash(s: string): string {
  // FNV-1a 32-bit x2 — only for repeat-detection ids, not security.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function parseDate(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v.trim());
  return Number.isFinite(t) ? t : null;
}

function collectRawUrls(v: unknown): string[] {
  if (typeof v === 'string') return v.split(/[\n\r]+|\s+/);
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === 'string' ? x.split(/[\n\r]+/) : []));
  return [];
}

export function parseCaptureFile(fileName: string, content: string): Capture | FileProblem {
  if (content.length > LIMITS.captureFileBytes) return { fileName, reason: 'File is too large for a capture' };
  const trimmed = content.replace(/^\ufeff/, '').trim();
  if (!trimmed) return { fileName, reason: 'Empty file' };

  let urlsRaw: string[] = [];
  let text = '';
  let id: string | null = null;
  let createdAt: number | null = null;
  let json: unknown = undefined;
  if (trimmed.startsWith('{')) {
    try {
      json = JSON.parse(trimmed);
    } catch {
      return { fileName, reason: 'Not valid JSON' };
    }
  }
  if (json !== undefined) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return { fileName, reason: 'Unexpected JSON shape' };
    const o = json as Record<string, unknown>;
    if (o.format === 'save-library-backup') return { fileName, reason: 'This is a backup — use Restore backup' };
    if (o.format !== undefined && o.format !== CAPTURE_FORMAT) return { fileName, reason: 'Unknown file format' };
    const v = Number(o.v ?? o.version ?? 1);
    if (!Number.isFinite(v) || v > CAPTURE_VERSION) return { fileName, reason: `Unsupported capture version ${String(o.v)}` };
    urlsRaw = [...collectRawUrls(o.urls), ...collectRawUrls(o.url)];
    text = cleanText(o.text, LIMITS.sharedText * 2);
    if (typeof o.id === 'string' && o.id.trim()) id = o.id.trim().slice(0, 100);
    createdAt = parseDate(o.createdAt ?? o.timestamp);
  } else {
    text = cleanText(trimmed, LIMITS.sharedText * 2);
  }

  const urls: string[] = [];
  let invalid = 0;
  for (const raw of urlsRaw.map((s) => s.trim()).filter(Boolean)) {
    const a = analyzeLink(raw);
    if (a.ok) {
      if (!urls.includes(a.info.url)) urls.push(a.info.url);
    } else invalid++;
  }
  for (const u of extractUrls(text)) if (!urls.includes(u)) urls.push(u);

  if (urls.length === 0) return { fileName, reason: invalid ? 'No valid link (only unsupported links)' : 'No link found' };
  return {
    id: id ?? 'h:' + hash(urls.join('\n') + '\n' + text + '\n' + (createdAt ?? '')),
    fileName,
    createdAt,
    urls,
    text,
    invalid,
  };
}

export function isCapture(x: Capture | FileProblem): x is Capture {
  return 'urls' in x;
}

/* ------------------------------------------------------------------ */
/* Bulk paste                                                          */
/* ------------------------------------------------------------------ */

export interface Candidate {
  info: LinkInfo;
  sharedText: string;
  createdAt: number | null;
  captureId?: string;
}

/** One candidate per link. Text on the same line (minus the links) becomes the shared text. */
export function parseBulkText(text: string): { candidates: Candidate[]; invalid: number; truncated: boolean } {
  const truncated = text.length > LIMITS.bulkPasteChars;
  const src = truncated ? text.slice(0, LIMITS.bulkPasteChars) : text;
  const candidates: Candidate[] = [];
  let invalid = 0;
  for (const line of src.split(/\r?\n/)) {
    const found = extractUrls(line);
    // Count http-looking tokens that failed validation so the preview can report them.
    const httpTokens = line.match(/https?:\/\/\S+/gi)?.length ?? 0;
    invalid += Math.max(0, httpTokens - found.length);
    const rest = cleanText(textWithoutUrls(line), LIMITS.sharedText);
    for (const u of found) {
      const a = analyzeLink(u);
      if (a.ok) candidates.push({ info: a.info, sharedText: rest, createdAt: null });
      if (candidates.length >= LIMITS.bulkPasteUrls) return { candidates, invalid, truncated: true };
    }
  }
  return { candidates, invalid, truncated };
}

export function capturesToCandidates(captures: Capture[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of captures) {
    const shared = cleanText(textWithoutUrls(c.text), LIMITS.sharedText);
    for (const u of c.urls) {
      const a = analyzeLink(u);
      if (a.ok) out.push({ info: a.info, sharedText: shared, createdAt: c.createdAt, captureId: c.id });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Planning (preview + dedupe)                                         */
/* ------------------------------------------------------------------ */

export interface ImportPlan {
  toAdd: Bookmark[];
  duplicates: number;
  invalid: number;
}

export function planImport(
  candidates: Candidate[],
  existingKeys: Set<string>,
  source: BookmarkSource,
  invalid = 0,
  now = Date.now(),
): ImportPlan {
  const seen = new Set(existingKeys);
  const toAdd: Bookmark[] = [];
  let duplicates = 0;
  candidates.forEach((c, i) => {
    if (seen.has(c.info.key)) {
      duplicates++;
      return;
    }
    seen.add(c.info.key);
    // Keep given order newest-first while giving each item a distinct timestamp.
    const t = c.createdAt ?? now - i;
    toAdd.push(newBookmark(c.info, { sharedText: c.sharedText, source, savedAt: Math.min(t, now) }));
  });
  return { toAdd, duplicates, invalid };
}

export function newBookmark(
  info: LinkInfo,
  extra: Partial<Pick<Bookmark, 'sharedText' | 'title' | 'note' | 'tags' | 'categoryId' | 'savedAt'>> & {
    source: BookmarkSource;
  },
): Bookmark {
  const now = Date.now();
  return {
    id: uid(),
    url: info.url,
    key: info.key,
    platform: info.platform,
    mediaType: info.mediaType,
    savedAt: extra.savedAt ?? now,
    updatedAt: now,
    sharedText: extra.sharedText ? cleanText(extra.sharedText, LIMITS.sharedText) : undefined,
    title: extra.title ? cleanText(extra.title, LIMITS.title) : undefined,
    note: extra.note ? cleanText(extra.note, LIMITS.note) : undefined,
    tags: cleanTags(extra.tags ?? [], LIMITS.tag, LIMITS.tags),
    categoryId: extra.categoryId ?? null,
    source: extra.source,
  };
}

/* ------------------------------------------------------------------ */
/* Backup / restore                                                    */
/* ------------------------------------------------------------------ */

export const BACKUP_FORMAT = 'save-library-backup';
/** v1: bookmarks + categories. v2: adds `covers` (resized data URLs). */
export const BACKUP_VERSION = 2;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  categories: Category[];
  bookmarks: Bookmark[];
  covers?: Record<string, { dataUrl: string; width: number; height: number }>;
}

export interface RestorePlan {
  categoriesToAdd: Category[];
  /** backup category id -> local category id */
  categoryMap: Map<string, string>;
  toAdd: Bookmark[];
  covers: Map<string, { bytes: ArrayBuffer; type: string; width: number; height: number }>;
  duplicates: number;
  invalid: number;
  coversSkipped: number;
}

const COVER_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

export function decodeDataUrl(dataUrl: unknown): { type: string; bytes: ArrayBuffer } | null {
  if (typeof dataUrl !== 'string' || dataUrl.length > LIMITS.coverBytes * 1.4 + 64) return null;
  const m = COVER_DATA_URL.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[2]!);
    if (bin.length > LIMITS.coverBytes) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isWebp = bin.slice(0, 4) === 'RIFF' && bin.slice(8, 12) === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) return null;
    return { type: m[1]!, bytes: bytes.buffer };
  } catch {
    return null;
  }
}

export function encodeDataUrl(type: string, bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

export type ParsedBackup = { ok: true; backup: BackupFile } | { ok: false; reason: string };

export function parseBackup(content: string): ParsedBackup {
  if (content.length > LIMITS.backupBytes) return { ok: false, reason: 'Backup is larger than the 40 MB limit' };
  let o: unknown;
  try {
    o = JSON.parse(content.replace(/^\ufeff/, ''));
  } catch {
    return { ok: false, reason: 'Not valid JSON' };
  }
  if (!o || typeof o !== 'object') return { ok: false, reason: 'Not a backup file' };
  const b = o as Record<string, unknown>;
  if (b.format === CAPTURE_FORMAT) return { ok: false, reason: 'This is a Shortcut capture — use Import Shortcut Inbox' };
  if (b.format !== BACKUP_FORMAT) return { ok: false, reason: 'Not a Save Library backup' };
  const version = Number(b.version);
  if (!Number.isInteger(version) || version < 1) return { ok: false, reason: 'Missing backup version' };
  if (version > BACKUP_VERSION) return { ok: false, reason: `Backup version ${version} is newer than this app supports` };
  if (!Array.isArray(b.bookmarks)) return { ok: false, reason: 'Backup has no bookmarks list' };
  if (b.bookmarks.length > LIMITS.backupBookmarks) return { ok: false, reason: 'Backup has too many bookmarks' };
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      version,
      exportedAt: String(b.exportedAt ?? ''),
      categories: Array.isArray(b.categories) ? (b.categories as Category[]) : [],
      bookmarks: b.bookmarks as Bookmark[],
      covers: version >= 2 && b.covers && typeof b.covers === 'object' ? (b.covers as BackupFile['covers']) : undefined,
    },
  };
}

/** Validate every field again; existing bookmarks (same key) keep their annotations untouched. */
export function planRestore(
  backup: BackupFile,
  existingKeys: Set<string>,
  existingCategories: Category[],
): RestorePlan {
  const categoryMap = new Map<string, string>();
  const categoriesToAdd: Category[] = [];
  const byName = new Map(existingCategories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const byId = new Set(existingCategories.map((c) => c.id));
  for (const raw of backup.categories.slice(0, LIMITS.categories)) {
    if (!raw || typeof raw !== 'object') continue;
    const name = cleanText((raw as Category).name, LIMITS.categoryName).replace(/\s+/g, ' ');
    const id = typeof raw.id === 'string' ? raw.id.slice(0, 100) : '';
    if (!name || !id) continue;
    const local = byName.get(name.toLowerCase());
    if (local) categoryMap.set(id, local);
    else {
      const newId = byId.has(id) ? uid() : id;
      const c: Category = { id: newId, name, createdAt: Number(raw.createdAt) || Date.now() };
      categoriesToAdd.push(c);
      byName.set(name.toLowerCase(), newId);
      byId.add(newId);
      categoryMap.set(id, newId);
    }
  }

  const seen = new Set(existingKeys);
  const toAdd: Bookmark[] = [];
  const covers: RestorePlan['covers'] = new Map();
  let duplicates = 0;
  let invalid = 0;
  let coversSkipped = 0;
  const now = Date.now();
  for (const raw of backup.bookmarks) {
    if (!raw || typeof raw !== 'object') {
      invalid++;
      continue;
    }
    const a = analyzeLink(raw.url);
    if (!a.ok) {
      invalid++;
      continue;
    }
    if (seen.has(a.info.key)) {
      duplicates++;
      continue;
    }
    seen.add(a.info.key);
    const mediaType: MediaType =
      raw.mediaTypeEdited && (MEDIA_TYPES as readonly string[]).includes(raw.mediaType) ? raw.mediaType : a.info.mediaType;
    const savedAt = Number(raw.savedAt);
    const b = newBookmark(a.info, {
      sharedText: typeof raw.sharedText === 'string' ? raw.sharedText : undefined,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      note: typeof raw.note === 'string' ? raw.note : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      categoryId: typeof raw.categoryId === 'string' ? categoryMap.get(raw.categoryId) ?? null : null,
      savedAt: Number.isFinite(savedAt) && savedAt > 0 && savedAt <= now + 86400000 ? savedAt : now,
      source: 'backup',
    });
    b.mediaType = mediaType;
    if (raw.mediaTypeEdited) b.mediaTypeEdited = true;
    const cover = backup.covers && typeof raw.id === 'string' ? backup.covers[raw.id] : undefined;
    if (cover) {
      const d = decodeDataUrl(cover.dataUrl);
      if (d) {
        covers.set(b.id, { ...d, width: Number(cover.width) || 0, height: Number(cover.height) || 0 });
        b.hasCover = true;
      } else coversSkipped++;
    }
    toAdd.push(b);
  }
  return { categoriesToAdd, categoryMap, toAdd, covers, duplicates, invalid, coversSkipped };
}
