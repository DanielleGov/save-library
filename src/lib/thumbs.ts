import type { Bookmark } from './types';
import { youtubeVideoId } from './url';

/**
 * Provider-controlled HTTPS image origins that may be loaded when the user enables remote previews.
 * Mirrored in the Content-Security-Policy `img-src` in index.html.
 */
export const ALLOWED_THUMB_ORIGINS = ['https://i.ytimg.com'] as const;

/**
 * Remote thumbnail URL derived purely from a validated id — never from URLs inside imported data.
 *
 * - YouTube: documented, key-free still at i.ytimg.com/vi/<id>/mqdefault.jpg (320x180).
 * - TikTok: oEmbed returns signed, expiring CDN URLs and needs a cross-origin JSON fetch; not used.
 * - Facebook/Instagram: Meta oEmbed no longer returns thumbnails; use a placeholder or a user cover.
 */
export function remoteThumbUrl(b: Pick<Bookmark, 'url' | 'platform'>): string | null {
  if (b.platform !== 'youtube') return null;
  let u: URL;
  try {
    u = new URL(b.url);
  } catch {
    return null;
  }
  const id = youtubeVideoId(u);
  if (!id) return null;
  const src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  return isAllowedThumbUrl(src) ? src : null;
}

export function isAllowedThumbUrl(src: string): boolean {
  try {
    const u = new URL(src);
    return u.protocol === 'https:' && (ALLOWED_THUMB_ORIGINS as readonly string[]).includes(u.origin);
  } catch {
    return false;
  }
}
