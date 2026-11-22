import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capturesToCandidates, decodeImage, isCapture, parseCaptureFile, planImport } from '../src/lib/importer';
import { cleanScreenText, meaningfulShareTitle, titleFromScreenText } from '../src/lib/screentext';
import { suggestCategory } from '../src/lib/suggest';

const reelScreen = [
  '21:16', "when you're asked in a job", 'interview', '81.9K', '587', '10.5K', 'Synthetic Creator',
  'The best way to get better at intervi... more', '0:00 / 1:38', 'Add a comment', '114K',
].join('\n');

describe('screen text cleanup', () => {
  it('drops clock, counters, durations and buttons', () => {
    expect(cleanScreenText(reelScreen).split('\n')).toEqual([
      "when you're asked in a job", 'interview', 'Synthetic Creator', 'The best way to get better at intervi…',
    ]);
  });
  it('builds a readable title, joining wrapped lines', () => {
    expect(titleFromScreenText(cleanScreenText(reelScreen))).toBe(
      "when you're asked in a job interview · Synthetic Creator",
    );
  });
  it('handles Hebrew UI words and text', () => {
    const he = cleanScreenText('12:03\nמתכון לעוגת שוקולד בלי אפייה\nאהבתי\nתגובה\nשיתוף\n1.2K');
    expect(he).toBe('מתכון לעוגת שוקולד בלי אפייה');
  });
  it('returns empty for pure noise', () => {
    expect(cleanScreenText('21:16\n81.9K\nLike\nShare\n😂😂')).toBe('');
    expect(titleFromScreenText('')).toBe('');
  });
});

describe('share-sheet titles', () => {
  it('rejects URLs, domains and generic words', () => {
    expect(meaningfulShareTitle('https://www.facebook.com/share/v/X/')).toBe('');
    expect(meaningfulShareTitle('facebook.com')).toBe('');
    expect(meaningfulShareTitle('URL')).toBe('');
    expect(meaningfulShareTitle('Facebook')).toBe('');
    expect(meaningfulShareTitle('Easy linen apron — free pattern')).toBe('Easy linen apron — free pattern');
  });
});

describe('capture with screenshot', () => {
  const file = 'capture-20261122-211600-5150-screenshot.json';
  const content = readFileSync(join(__dirname, '..', 'fixtures', 'shortcut-inbox', file), 'utf8');

  it('parses cover, screen text and derives a title', () => {
    const c = parseCaptureFile(file, content);
    if (!isCapture(c)) throw new Error(c.reason);
    expect(c.cover?.type).toBe('image/jpeg');
    expect(c.shareTitle).toBeUndefined(); // the "title" was just the URL
    const plan = planImport(capturesToCandidates([c]), new Set(), 'shortcut');
    const b = plan.toAdd[0]!;
    expect(b.autoTitle).toBe("when you're asked in a job interview · Synthetic Creator");
    expect(b.screenText).toContain('Synthetic Creator');
    expect(plan.covers?.get(b.id)?.type).toBe('image/jpeg');
  });

  it('ignores a screenshot taken long before the share', () => {
    const o = JSON.parse(content);
    o.screenshotAt = '2026-11-20T10:00:00+02:00';
    const c = parseCaptureFile('old.json', JSON.stringify(o));
    if (!isCapture(c)) throw new Error();
    expect(c.cover).toBeUndefined();
    expect(c.screenText).toBeUndefined();
  });

  it('rejects non-image or oversized cover data', () => {
    expect(decodeImage('PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', 1e6)).toBeNull(); // svg
    expect(decodeImage('not base64!!', 1e6)).toBeNull();
    expect(decodeImage('', 1e6)).toBeNull();
  });

  it('screen text feeds category suggestions', () => {
    const s = suggestCategory({ tags: [], screenText: 'Easy tote bag\nsewing pattern for beginners' }, [{ id: 's', name: 'Sewing', createdAt: 1 }]);
    expect(s).toMatchObject({ categoryId: 's' });
  });
});
