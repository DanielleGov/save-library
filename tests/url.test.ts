import { describe, expect, it } from 'vitest';
import { analyzeLink, dedupKey, detectMediaType, detectPlatform, extractUrls, validateUrl, youtubeVideoId } from '../src/lib/url';

const U = (s: string) => new URL(s);

describe('validateUrl', () => {
  it.each([
    'https://www.instagram.com/reel/ABC123/',
    'http://example.com',
    'https://sub.example.co.il/path?q=1#frag',
    'HTTPS://EXAMPLE.COM/A',
    'https://xn--4dbrk0ce.example/',
    'https://192.168.1.10:8080/x',
  ])('accepts %s', (u) => expect(validateUrl(u).ok).toBe(true));

  it.each([
    ['', 'empty'],
    ['ftp://example.com/file', 'non-http'],
    ['javascript:alert(1)', 'javascript'],
    ['data:text/html,hi', 'data'],
    ['https://user:pass@example.com/', 'credentials'],
    ['https://user@example.com/', 'username only'],
    ['https://exa mple.com/', 'space'],
    ['https://', 'no host'],
    ['https://localhost/', 'single-label host'],
    ['https://-bad-.com/', 'bad label'],
    ['https://example.com/' + 'a'.repeat(3000), 'too long'],
    ['www.example.com', 'no scheme'],
  ])('rejects %s (%s)', (u) => expect(validateUrl(u).ok).toBe(false));

  it('keeps the original string exactly (trimmed only)', () => {
    const v = validateUrl('  https://www.tiktok.com/@a/video/123?is_from_webapp=1&_t=X  ');
    expect(v.ok && v.raw).toBe('https://www.tiktok.com/@a/video/123?is_from_webapp=1&_t=X');
  });
});

describe('extractUrls', () => {
  it('pulls links from share-sheet text and strips trailing punctuation', () => {
    const t = 'Check this out! https://vm.tiktok.com/ZSYN1/. Also (https://example.com/a_(b)) and https://x.com/y,';
    expect(extractUrls(t)).toEqual(['https://vm.tiktok.com/ZSYN1/', 'https://example.com/a_(b)', 'https://x.com/y']);
  });
  it('handles Hebrew text around links', () => {
    expect(extractUrls('מתכון מעולה: https://www.instagram.com/p/SYN1/ שווה!')).toEqual(['https://www.instagram.com/p/SYN1/']);
  });
  it('returns nothing when there is no link', () => {
    expect(extractUrls('no links here, just www.example.com')).toEqual([]);
  });
  it('dedupes identical links and skips invalid ones', () => {
    expect(extractUrls('https://a.com/x https://a.com/x https://u:p@b.com/')).toEqual(['https://a.com/x']);
  });
});

describe('platform detection', () => {
  it.each([
    ['https://www.instagram.com/reel/X/', 'instagram'],
    ['https://m.facebook.com/story.php?id=1', 'facebook'],
    ['https://fb.watch/abc/', 'facebook'],
    ['https://vm.tiktok.com/Z/', 'tiktok'],
    ['https://youtu.be/aaaaaaaaaaa', 'youtube'],
    ['https://pin.it/abc', 'pinterest'],
    ['https://www.pinterest.co.uk/pin/123456/', 'pinterest'],
    ['https://www.etsy.com/listing/1/x', 'etsy'],
    ['https://notinstagram.com/reel/X', 'other'],
    ['https://instagram.com.evil.example/reel/X', 'other'],
    ['https://myfacebook.com/', 'other'],
  ])('%s → %s', (u, p) => expect(detectPlatform(U(u))).toBe(p));
});

describe('media type inference', () => {
  it.each([
    ['https://www.instagram.com/reel/X/', 'reel'],
    ['https://www.instagram.com/reels/X/', 'reel'],
    ['https://www.instagram.com/p/X/', 'post'],
    ['https://www.instagram.com/someuser/', 'unknown'],
    ['https://www.facebook.com/reel/123', 'reel'],
    ['https://www.facebook.com/share/r/abc/', 'reel'],
    ['https://www.facebook.com/share/v/abc/', 'video'],
    ['https://www.facebook.com/share/p/abc/', 'post'],
    ['https://www.facebook.com/page/videos/123/', 'video'],
    ['https://www.facebook.com/watch/?v=123', 'video'],
    ['https://www.facebook.com/groups/1/posts/2/', 'post'],
    ['https://www.tiktok.com/@u/video/7123', 'video'],
    ['https://www.tiktok.com/@u/photo/7123', 'photo'],
    ['https://vm.tiktok.com/ZS/', 'unknown'],
    ['https://www.youtube.com/shorts/aaaaaaaaaaa', 'short'],
    ['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'video'],
    ['https://youtu.be/aaaaaaaaaaa', 'video'],
    ['https://www.youtube.com/playlist?list=PL1', 'playlist'],
    ['https://www.youtube.com/@chan', 'profile'],
    ['https://www.pinterest.com/pin/123/', 'pin'],
    ['https://www.etsy.com/listing/123/x', 'listing'],
    ['https://www.etsy.com/il-en/listing/123/x', 'listing'],
    ['https://www.etsy.com/shop/Foo', 'shop'],
    ['https://example.com/recipe', 'unknown'],
  ])('%s → %s', (u, t) => expect(detectMediaType(U(u))).toBe(t));
});

describe('youtubeVideoId', () => {
  it('extracts and validates ids', () => {
    expect(youtubeVideoId(U('https://youtu.be/dQw4w9WgXcQ?si=x'))).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId(U('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1'))).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId(U('https://www.youtube.com/shorts/dQw4w9WgXcQ'))).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId(U('https://www.youtube.com/watch?v=short'))).toBeNull();
    expect(youtubeVideoId(U('https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>'))).toBeNull();
    expect(youtubeVideoId(U('https://evil.com/watch?v=dQw4w9WgXcQ'))).toBeNull();
  });
});

describe('dedupKey', () => {
  const same = (a: string, b: string) => expect(dedupKey(U(a))).toBe(dedupKey(U(b)));
  const diff = (a: string, b: string) => expect(dedupKey(U(a))).not.toBe(dedupKey(U(b)));
  it('collapses share-tracking variants', () => {
    same('https://www.instagram.com/reel/SYN1/?igsh=abc', 'https://instagram.com/reels/SYN1');
    same('https://www.instagram.com/p/SYN1/', 'https://www.instagram.com/reel/SYN1/');
    same('https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share');
    same('https://www.tiktok.com/@a/video/123?_t=1&_r=1', 'https://m.tiktok.com/@b/video/123');
    same('https://example.com/a/?utm_source=x&b=2&a=1', 'https://www.example.com/a?a=1&b=2#top');
    same('https://m.facebook.com/story.php?story_fbid=1&id=2&mibextid=x', 'https://www.facebook.com/story.php?id=2&story_fbid=1');
  });
  it('keeps meaningful parameters and case-sensitive ids apart', () => {
    diff('https://www.instagram.com/reel/abc/', 'https://www.instagram.com/reel/ABC/');
    diff('https://example.com/item?id=1', 'https://example.com/item?id=2');
    diff('https://vm.tiktok.com/ZA/', 'https://vm.tiktok.com/ZB/');
  });
});

describe('analyzeLink', () => {
  it('does not resolve short links', () => {
    const a = analyzeLink('https://vm.tiktok.com/ZS123/');
    expect(a.ok && a.info).toMatchObject({ platform: 'tiktok', mediaType: 'unknown', url: 'https://vm.tiktok.com/ZS123/' });
  });
});
