const HEBREW_FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/**
 * Normalize text for matching: Unicode NFKD, lower case, strip Latin diacritics and Hebrew
 * niqqud/cantillation, unify Hebrew final letters, collapse whitespace.
 */
export function normalize(s: string): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u0591-\u05c7\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (c) => HEBREW_FINALS[c] ?? c)
    .replace(/[\u05be\-_/\\|.,;:!?()[\]{}"'`\u2019\u201c\u201d\u05f4\u05f3]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  return normalize(s.replace(/#/g, ' ')).split(' ').filter(Boolean);
}

/** Clean untrusted plain text: drop control chars (keep newlines/tabs), cap length. */
export function cleanText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

export function cleanTags(input: unknown, maxTag: number, maxCount: number): string[] {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,\n]/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const v = t.replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, maxTag);
    const k = normalize(v);
    if (v && !seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
    if (out.length >= maxCount) break;
  }
  return out;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
