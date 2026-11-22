import { describe, expect, it } from 'vitest';
import { isAllowedThumbUrl, remoteThumbUrl } from '../src/lib/thumbs';

describe('remote thumbnails', () => {
  it('derives YouTube thumbnails from validated ids only', () => {
    expect(remoteThumbUrl({ platform: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' })).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
    expect(remoteThumbUrl({ platform: 'youtube', url: 'https://www.youtube.com/playlist?list=PL1' })).toBeNull();
  });
  it('has no remote source for Meta, TikTok or arbitrary sites', () => {
    expect(remoteThumbUrl({ platform: 'instagram', url: 'https://www.instagram.com/reel/X/' })).toBeNull();
    expect(remoteThumbUrl({ platform: 'tiktok', url: 'https://www.tiktok.com/@a/video/1' })).toBeNull();
    expect(remoteThumbUrl({ platform: 'other', url: 'https://example.com/img.jpg' })).toBeNull();
  });
  it('allows only provider-controlled HTTPS origins', () => {
    expect(isAllowedThumbUrl('https://i.ytimg.com/vi/x/mqdefault.jpg')).toBe(true);
    expect(isAllowedThumbUrl('http://i.ytimg.com/vi/x/mqdefault.jpg')).toBe(false);
    expect(isAllowedThumbUrl('https://i.ytimg.com.evil.com/x.jpg')).toBe(false);
  });
});
