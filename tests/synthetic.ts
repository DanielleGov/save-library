import type { Bookmark, Platform, MediaType } from '../src/lib/types';

const SAMPLES: Array<[Platform, MediaType, (i: number) => string]> = [
  ['instagram', 'reel', (i) => `https://www.instagram.com/reel/SYN${i.toString(36)}/`],
  ['facebook', 'reel', (i) => `https://www.facebook.com/reel/${100000 + i}`],
  ['tiktok', 'video', (i) => `https://www.tiktok.com/@synthetic/video/${7000000000 + i}`],
  ['youtube', 'video', (i) => `https://www.youtube.com/watch?v=${('SYN' + i.toString(36)).padEnd(11, 'x').slice(0, 11)}`],
  ['pinterest', 'pin', (i) => `https://www.pinterest.com/pin/${900000 + i}/`],
  ['etsy', 'listing', (i) => `https://www.etsy.com/listing/${500000 + i}/synthetic-item`],
  ['other', 'unknown', (i) => `https://example.com/article/${i}`],
];
const TEXT = ['Tote bag sewing tutorial', 'מתכון לעוגת שוקולד', 'Easy dinner recipe', 'Linen apron pattern', 'יוגה לבוקר', 'Home decor ideas', ''];

/** Deterministic synthetic bookmarks, newest first. */
export function syntheticLibrary(n: number, now = 1_790_000_000_000): Bookmark[] {
  return Array.from({ length: n }, (_, i) => {
    const [platform, mediaType, url] = SAMPLES[i % SAMPLES.length]!;
    const u = url(i);
    return {
      id: `syn-${i}`, url: u, key: `syn:${i}`, platform, mediaType, savedAt: now - i * 60_000, updatedAt: now,
      sharedText: TEXT[i % TEXT.length] || undefined, title: i % 5 === 0 ? `Saved item ${i}` : undefined,
      tags: i % 3 === 0 ? ['ideas'] : [], categoryId: null, source: 'manual',
    } satisfies Bookmark;
  });
}
