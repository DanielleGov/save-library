import { LIMITS, type MediaType, type Platform } from './types';

export type UrlResult = { ok: true; url: URL; raw: string } | { ok: false; reason: string };

/**
 * Validate a single link. Same rules for every capture/import route:
 * HTTP(S) only, no embedded credentials, a real-looking host, no whitespace, bounded length.
 */
export function validateUrl(input: unknown): UrlResult {
  if (typeof input !== 'string') return { ok: false, reason: 'Not text' };
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'Empty' };
  if (raw.length > LIMITS.url) return { ok: false, reason: 'Link is too long' };
  if (!/^https?:\/\//i.test(raw)) return { ok: false, reason: 'Only http(s) links are supported' };
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return { ok: false, reason: 'Link contains spaces or control characters' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Malformed link' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http(s) links are supported' };
  }
  if (url.username || url.password) return { ok: false, reason: 'Links with embedded credentials are not allowed' };
  // Some parsers accept "http://user@host" with empty password; catch a literal "@" in the authority too.
  const authority = raw.replace(/^https?:\/\//i, '').split(/[/?#]/, 1)[0] ?? '';
  if (authority.includes('@')) return { ok: false, reason: 'Links with embedded credentials are not allowed' };
  const host = url.hostname;
  if (!host) return { ok: false, reason: 'Missing host' };
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  if (!isIp && !/^([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(host)) return { ok: false, reason: 'Invalid host' };
  if (host.split('.').some((l) => l.length > 63 || l.startsWith('-') || l.endsWith('-'))) {
    return { ok: false, reason: 'Invalid host' };
  }
  return { ok: true, url, raw };
}

const URL_RE = /https?:\/\/[^\s<>"'`\u00a0\u200b-\u200f\u2028\u2029]+/gi;
const TRAILING = /[.,;:!?'"\u2019\u201d\u05f3\u05f4]+$/;

function trimTrailing(candidate: string): string {
  let s = candidate;
  for (;;) {
    const before = s;
    s = s.replace(TRAILING, '');
    // drop unbalanced closing brackets at the end
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
      if (s.endsWith(close)) {
        const opens = s.split(open).length - 1;
        const closes = s.split(close).length - 1;
        if (closes > opens) s = s.slice(0, -1);
      }
    }
    if (s === before) return s;
  }
}

/** Find all valid, distinct HTTP(S) links in free text (share-sheet text, pasted text, capture files). */
export function extractUrls(text: string): string[] {
  if (typeof text !== 'string' || !text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const candidate = trimTrailing(m[0]);
    const v = validateUrl(candidate);
    if (v.ok && !seen.has(v.raw)) {
      seen.add(v.raw);
      out.push(v.raw);
    }
  }
  return out;
}

/** Remove links from text, collapse whitespace; returns '' if nothing meaningful remains. */
export function textWithoutUrls(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(URL_RE, ' ')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PLATFORM_DOMAINS: Array<[Platform, string[]]> = [
  ['instagram', ['instagram.com', 'instagr.am', 'ig.me']],
  ['facebook', ['facebook.com', 'fb.com', 'fb.watch', 'fb.me', 'messenger.com']],
  ['tiktok', ['tiktok.com']],
  ['youtube', ['youtube.com', 'youtu.be', 'youtube-nocookie.com']],
  [
    'pinterest',
    [
      'pinterest.com', 'pin.it', 'pinterest.co.uk', 'pinterest.ca', 'pinterest.de', 'pinterest.fr',
      'pinterest.es', 'pinterest.it', 'pinterest.com.au', 'pinterest.co.il', 'pinterest.jp',
      'pinterest.com.mx', 'pinterest.nz', 'pinterest.ie', 'pinterest.at', 'pinterest.ch', 'pinterest.pt',
    ],
  ],
  ['etsy', ['etsy.com', 'etsy.me']],
];

export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === domain || h.endsWith('.' + domain);
}

export function detectPlatform(url: URL): Platform {
  for (const [platform, domains] of PLATFORM_DOMAINS) {
    if (domains.some((d) => hostMatches(url.hostname, d))) return platform;
  }
  return 'other';
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Return a validated 11-character YouTube video id, or null. */
export function youtubeVideoId(url: URL): string | null {
  if (detectPlatform(url) !== 'youtube') return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (hostMatches(host, 'youtu.be')) id = parts[0] ?? null;
  else if (parts[0] === 'watch') id = url.searchParams.get('v');
  else if (['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0] ?? '')) id = parts[1] ?? null;
  return id && YT_ID.test(id) ? id : null;
}

export function detectMediaType(url: URL, platform: Platform = detectPlatform(url)): MediaType {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean).map((p) => p.toLowerCase());
  const p0 = parts[0] ?? '';
  switch (platform) {
    case 'instagram':
      if (p0 === 'reel' || p0 === 'reels') return parts[1] ? 'reel' : 'unknown';
      if (p0 === 'p') return 'post';
      if (p0 === 'tv') return 'video';
      if (p0 === 'stories') return 'story';
      if (parts[1] === 'reel' || parts[1] === 'reels') return parts[2] ? 'reel' : 'unknown';
      if (parts[1] === 'p') return 'post';
      return 'unknown';
    case 'facebook': {
      if (hostMatches(host, 'fb.watch')) return 'video';
      if (p0 === 'reel' || p0 === 'reels') return 'reel';
      if (p0 === 'share') {
        if (parts[1] === 'r') return 'reel';
        if (parts[1] === 'v') return 'video';
        if (parts[1] === 'p') return 'post';
        return 'unknown';
      }
      if (p0 === 'watch' || parts.includes('videos')) return 'video';
      if (p0 === 'stories') return 'story';
      if (parts.includes('posts') || p0 === 'permalink.php' || p0 === 'story.php') return 'post';
      if (p0 === 'photo' || p0 === 'photo.php' || parts.includes('photos')) return 'photo';
      return 'unknown';
    }
    case 'tiktok':
      if (parts[1] === 'video') return 'video';
      if (parts[1] === 'photo') return 'photo';
      return 'unknown'; // short links (vm./vt./t/) are opaque; never resolved
    case 'youtube':
      if (p0 === 'shorts') return 'short';
      if (p0 === 'playlist') return 'playlist';
      if (youtubeVideoId(url)) return 'video';
      if (p0.startsWith('@') || p0 === 'channel' || p0 === 'c' || p0 === 'user') return 'profile';
      return 'unknown';
    case 'pinterest':
      if (p0 === 'pin') return 'pin';
      return 'unknown';
    case 'etsy': {
      const i = parts[0]?.length === 2 || /^[a-z]{2}-[a-z]{2}$/.test(p0) ? 1 : 0; // locale prefix
      if (parts[i] === 'listing') return 'listing';
      if (parts[i] === 'shop') return 'shop';
      return 'unknown';
    }
    default:
      return 'unknown';
  }
}

/** Query parameters that only track the share and never change the content. */
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'igsh', 'igshid', 'mibextid', 'rdid', 'share_url', 'si',
  'feature', 'pp', 'is_from_webapp', 'sender_device', 'sender_web_id', 'is_copy_url', '_r', '_t',
  'share_app_id', 'share_link_id', 'social_sharing', 'tt_from', 'u_code', 'user_id', 'web_id',
  'ref', 'ref_src', 'ref_url', 'click_key', 'click_sum', 'ga_order', 'ga_search_type', 'ga_view_type',
  'ga_search_query', 'sts', 'organic_search_click', 'epik', 'invite_code', 'xmt', 'sfnsn', 'wtsid',
  'ttclid', 'mc_cid', 'mc_eid', 'checksum', 'sec_user_id', 'share_item_id', 'timestamp',
]);

function isTracking(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || n.startsWith('__') || TRACKING_PARAMS.has(n);
}

/**
 * Duplicate-detection key. Never shown or opened — the original URL is always kept.
 * Content-identifying ids collapse equivalent links (e.g. instagram /reel/X and /reels/X).
 */
export function dedupKey(url: URL): string {
  const platform = detectPlatform(url);
  const parts = url.pathname.split('/').filter(Boolean);
  const yt = youtubeVideoId(url);
  if (yt) return `youtube:${yt}`;
  if (platform === 'instagram') {
    const i = parts.findIndex((p) => ['reel', 'reels', 'p', 'tv'].includes(p.toLowerCase()));
    if (i >= 0 && parts[i + 1]) return `instagram:${parts[i + 1]}`; // shortcodes are case-sensitive
  }
  if (platform === 'tiktok' && (parts[1] === 'video' || parts[1] === 'photo') && /^\d+$/.test(parts[2] ?? '')) {
    return `tiktok:${parts[2]}`;
  }
  if (platform === 'pinterest' && parts[0] === 'pin' && parts[1]) {
    const m = /(\d{5,})\/?$/.exec(parts[1]);
    if (m) return `pinterest:${m[1]}`;
  }
  if (platform === 'etsy') {
    const i = parts.indexOf('listing');
    if (i >= 0 && /^\d+$/.test(parts[i + 1] ?? '')) return `etsy:${parts[i + 1]}`;
  }
  if (platform === 'facebook' && (parts[0] === 'reel' || parts[0] === 'reels') && /^\d+$/.test(parts[1] ?? '')) {
    return `facebook:reel:${parts[1]}`;
  }
  if (platform === 'facebook' && parts[0] === 'watch' && url.searchParams.get('v')) {
    return `facebook:video:${url.searchParams.get('v')}`;
  }

  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (platform !== 'other') host = host.replace(/^(www|m|mobile|web|touch|mbasic)\./, '');
  else host = host.replace(/^www\./, '');
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !isTracking(k))
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  const qs = params.length ? '?' + new URLSearchParams(params).toString() : '';
  const path = url.pathname.replace(/\/+$/, '') || '';
  const port = url.port && url.port !== '80' && url.port !== '443' ? ':' + url.port : '';
  return `${host}${port}${path}${qs}`;
}

export interface LinkInfo {
  url: string;
  key: string;
  platform: Platform;
  mediaType: MediaType;
}

/** Validate and analyse one link. Returns null with a reason when invalid. */
export function analyzeLink(input: unknown): { ok: true; info: LinkInfo } | { ok: false; reason: string } {
  const v = validateUrl(input);
  if (!v.ok) return v;
  const platform = detectPlatform(v.url);
  return {
    ok: true,
    info: { url: v.raw, key: dedupKey(v.url), platform, mediaType: detectMediaType(v.url, platform) },
  };
}

/** Short human readable form (host + path) used when no title is available. */
export function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname === '/' ? '' : decodeSafe(u.pathname).replace(/\/$/, '');
    // Show the query when the path alone says little (e.g. youtube.com/watch?v=...).
    const query = u.search && path.split('/').filter(Boolean).length <= 1 ? decodeSafe(u.search) : '';
    return (u.hostname.replace(/^(www|m)\./, '') + path + query).slice(0, 120);
  } catch {
    return raw.slice(0, 120);
  }
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
