import { cleanText } from './text';
import { extractUrls } from './url';

/**
 * Text recognized on-device (iOS Live Text, via the Shortcut) from a screenshot of a post.
 * It is noisy: clock, like/comment counts, buttons. These helpers keep the meaningful lines and
 * derive a short title. Everything stays plain text and never leaves the device.
 */

/** Interface chrome seen on Facebook / Instagram / TikTok / YouTube screens (lower-case, exact line). */
const UI_LINES = new Set([
  'like', 'likes', 'comment', 'comments', 'share', 'shares', 'send', 'save', 'saved', 'follow', 'following',
  'followers', 'reply', 'replies', 'more', 'see more', 'see translation', 'add a comment', 'add a comment...',
  'write a comment', 'write a comment...', 'add comment', 'original audio', 'sponsored', 'suggested for you',
  'reels', 'reel', 'home', 'friends', 'video', 'videos', 'watch', 'search', 'menu', 'profile', 'notifications',
  'marketplace', 'for you', 'explore', 'inbox', 'shop', 'live', 'subscribe', 'subscribed', 'remix', 'use template',
  'facebook', 'instagram', 'tiktok', 'youtube', 'pinterest', 'etsy', 'messenger', 'paid partnership', 'gif',
  'translate', 'view all comments', 'view replies', 'liked by', 'add to cart', 'buy it now', 'visit',
  'אהבתי', 'לייק', 'תגובה', 'תגובות', 'שיתוף', 'שתף', 'שליחה', 'שמירה', 'עקוב', 'עוקבים', 'הוספת תגובה',
  'כתיבת תגובה', 'עוד', 'הצג עוד', 'השב', 'ממומן', 'מוצע עבורך', 'סרטונים', 'דף הבית', 'חברים', 'חיפוש',
]);

/** Lines that are only counts, times or durations: "81.9K", "587", "21:16", "0:00 / 1:38", "2h", "3 d". */
const NUMERIC_LINE = /^[\d\s.,:/·•|+\-–—%()kKmMbBhHdDwWsS]*$/;

function isNoise(line: string): boolean {
  const l = line.trim();
  if (l.length < 3) return true;
  if (NUMERIC_LINE.test(l)) return true;
  if (extractUrls(l).length && l.replace(/https?:\/\/\S+/g, '').trim().length < 3) return true;
  const lower = l.toLowerCase().replace(/[.…:]+$/, '').trim();
  if (UI_LINES.has(lower)) return true;
  // mostly symbols / emoji with very few letters
  const letters = (l.match(/\p{L}/gu) ?? []).length;
  return letters < 3;
}

/** Strip trailing "... more" / "…עוד" truncation markers. */
function stripMore(line: string): string {
  return line.replace(/\s*(\.\.\.|…)\s*(more|see more|עוד)?\s*$/i, '…').replace(/^…$/, '');
}

/** Clean recognized screen text: drop UI chrome and counters, keep line structure. */
export function cleanScreenText(raw: unknown, max = 3000): string {
  const text = cleanText(raw, max * 2);
  if (!text) return '';
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split('\n')) {
    const line = stripMore(rawLine.replace(/\s+/g, ' ').trim());
    if (!line || isNoise(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join('\n').slice(0, max);
}

/**
 * A short title from cleaned screen text: joins wrapped lines (a line that continues in lower case),
 * separates distinct lines with " · ", and caps the length.
 */
export function titleFromScreenText(cleaned: string, max = 90): string {
  const lines = cleaned.split('\n').filter(Boolean);
  if (!lines.length) return '';
  let out = '';
  for (const line of lines) {
    const continues = out && /^[a-z֐-׿]/.test(line) && !/[.!?…]$/.test(out);
    const next = out ? out + (continues ? ' ' : ' · ') + line : line;
    if (next.length > max) {
      if (!out) out = line.slice(0, max - 1).trimEnd() + '…';
      break;
    }
    out = next;
  }
  return out;
}

const GENERIC_SHARE_TITLES = new Set([
  'url', 'urls', 'text', 'link', 'links', 'facebook', 'instagram', 'tiktok', 'youtube', 'pinterest', 'etsy',
  'web page', 'webpage', 'safari', 'shortcut input', 'video', 'reel', 'post',
]);

/** Whether a title supplied by the sharing app is worth using (not a URL, host or generic word). */
export function meaningfulShareTitle(raw: unknown): string {
  const t = cleanText(raw, 300).replace(/\s+/g, ' ').trim();
  if (t.length < 3) return '';
  if (/https?:\/\//i.test(t)) return '';
  if (!/\s/.test(t) && /\.[a-z]{2,}$/i.test(t)) return ''; // looks like a bare domain
  if (GENERIC_SHARE_TITLES.has(t.toLowerCase())) return '';
  if ((t.match(/\p{L}/gu) ?? []).length < 3) return '';
  return t;
}
