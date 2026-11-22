// End-to-end check of the built PWA in Chromium with iPhone emulation.
// This is NOT a substitute for a real iPhone: Safari/WebKit, the share sheet, Shortcuts and Files
// are not exercised. Run: npm run e2e  (builds first). Screenshots go to .e2e-output/.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }
const { chromium, devices } = playwright;

const root = new URL('..', import.meta.url).pathname;
const out = join(root, '.e2e-output');
mkdirSync(out, { recursive: true });
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve());
  server.on('exit', (c) => reject(new Error('preview exited ' + c)));
  setTimeout(() => reject(new Error('preview timeout')), 15000);
});

const browser = await chromium.launch();
const thirdParty = [];
const ytRequests = [];

async function newContext() {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow', acceptDownloads: true });
  await ctx.route(/^https?:\/\/(?!localhost)/, async (route) => {
    const u = route.request().url();
    if (u.startsWith('https://i.ytimg.com/')) {
      ytRequests.push({ url: u, referer: route.request().headers()['referer'] ?? null });
      // Synthetic 320x180 JPEG stands in for YouTube (network access to i.ytimg.com is not available here).
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: ytJpeg });
    }
    thirdParty.push(u);
    return route.abort();
  });
  return ctx;
}

// Make a synthetic JPEG for the YouTube stand-in and a large "screenshot" PNG for the cover test.
const scratch = await browser.newPage();
await scratch.setViewportSize({ width: 320, height: 180 });
await scratch.setContent('<body style="margin:0;background:#c4221a;color:#fff;font:bold 48px sans-serif;display:grid;place-items:center;height:180px">YT</body>');
const ytJpeg = await scratch.screenshot({ type: 'jpeg' });
await scratch.setViewportSize({ width: 1170, height: 2532 });
await scratch.setContent('<body style="margin:0;height:2532px;background:linear-gradient(#ff9a8b,#7b3fc4);color:#fff;font:bold 160px sans-serif;display:grid;place-items:center">REEL</body>');
const coverPng = join(out, 'cover-input.png');
writeFileSync(coverPng, await scratch.screenshot({ type: 'png' }));
await scratch.close();

const ctx = await newContext();
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));
let nextPrompt = '';
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(nextPrompt) : d.accept()));

const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const tab = (name) => page.locator('.tabbar button', { hasText: name }).click();

try {
  await page.goto(BASE);
  await page.waitForSelector('text=Your library is empty.');
  check('App loads with empty library', true);
  await page.evaluate(() => navigator.serviceWorker.ready);
  check('Service worker registers', true);
  check('No horizontal scroll (empty)', await noHScroll());

  // Manual Add Link: invalid then valid
  await page.click('#add-btn');
  await page.fill('input[type=url]', 'javascript:alert(1)');
  await page.click('dialog button:has-text("Save")');
  check('Add Link rejects non-http', (await page.textContent('#add-err')).includes('http'));
  await page.fill('input[type=url]', 'https://user:pw@example.com/');
  await page.click('dialog button:has-text("Save")');
  check('Add Link rejects credentials', (await page.textContent('#add-err')).includes('credentials'));
  await page.fill('input[type=url]', 'https://www.facebook.com/reel/1234567890');
  await page.fill('dialog input[type=text] >> nth=0', 'Linen apron reel');
  await page.click('dialog button:has-text("Save")');
  await page.waitForSelector('.card');
  check('Manual Add Link saves', (await page.locator('.card').count()) === 1);
  await page.click('#add-btn');
  await page.fill('input[type=url]', 'https://facebook.com/reel/1234567890?mibextid=abc');
  await page.click('dialog button:has-text("Save")');
  check('Duplicate detected on manual add', (await page.textContent('#add-err')).includes('already'));
  await page.click('dialog button[aria-label=Close]');

  // Import Shortcut Inbox with fixtures
  const fixtures = readdirSync(join(root, 'fixtures/shortcut-inbox')).map((f) => join(root, 'fixtures/shortcut-inbox', f));
  await tab('More');
  let [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Import Shortcut Inbox")')]);
  check('Shortcut importer accepts multiple files', chooser.isMultiple());
  await chooser.setFiles(fixtures);
  await page.waitForSelector('dialog .stats');
  const stats = await page.locator('dialog .stats strong').allTextContents();
  check('Import preview counts (new/dup/invalid)', stats.join(',') === '6,0,2', stats.join(','));
  await shot('01-import-preview');
  await page.click('dialog button:has-text("Add 6")');
  await page.click('dialog button:has-text("Go to Inbox")');
  check('Screenshot capture gets auto title', (await page.locator('.card', { hasText: "when you're asked in a job interview" }).count()) === 1);
  await page.locator('.card', { hasText: 'job interview' }).locator('.thumb img[src^="blob:"]').waitFor({ timeout: 5000 }).catch(() => undefined);
  check('Screenshot capture gets a cover', (await page.locator('.card', { hasText: 'job interview' }).locator('.thumb img[src^="blob:"]').count()) === 1);
  check('Imported into Inbox', (await page.locator('.card').count()) === 7);

  [chooser] = await Promise.all([page.waitForEvent('filechooser'), (await tab('More'), page.click('button:has-text("Import Shortcut Inbox")'))]);
  await chooser.setFiles(fixtures);
  await page.waitForSelector('dialog .stats');
  const stats2 = await page.locator('dialog .stats strong').allTextContents();
  check('Repeat import adds nothing', stats2[0] === '0' && stats2[1] === '6', stats2.join(','));
  await page.click('dialog button:has-text("Cancel")');

  // Inbox suggestions: Sewing (new) from the Instagram capture text, Hebrew recipes from TikTok text
  await tab('Inbox');
  await shot('02-inbox-suggestions');
  const sewing = page.locator('.card', { hasText: 'tote bag sewing' });
  await sewing.locator('button:has-text("Create “Sewing”")').click();
  await page.waitForTimeout(100);
  const recipes = page.locator('.card', { hasText: 'מתכון' });
  check('Hebrew text suggests מתכונים', (await recipes.locator('button:has-text("מתכונים")').count()) === 1);
  await recipes.locator('button:has-text("מתכונים")').click();
  await tab('Categories');
  const catText = await page.locator('.cat-list').textContent();
  check('Categories created from suggestions', /Sewing\s*1 item/.test(catText) && /מתכונים\s*1 item/.test(catText), catText);

  // Bulk paste
  await page.click('#add-btn');
  await page.click('dialog button:has-text("Paste many")');
  await page.fill('dialog textarea', 'Bread recipe https://example.com/bread\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ&si=x\nhttps://www.instagram.com/reel/SYNTHETIC0001/\nftp://nope https://u:p@bad.example/');
  await page.click('dialog button:has-text("Preview")');
  const stats3 = await page.locator('dialog .stats strong').allTextContents();
  check('Bulk paste preview', stats3.join(',') === '2,1,1', stats3.join(','));
  await page.click('dialog button:has-text("Add 2")');

  // Remote previews off → no YouTube requests
  await tab('Library');
  await page.waitForTimeout(300);
  check('No thumbnail requests while previews are off', ytRequests.length === 0);
  await tab('More');
  await page.check('#remote-thumbs');
  await tab('Library');
  await page.waitForSelector('.thumb img[src^="https://i.ytimg.com/"]');
  check('YouTube thumbnail shown when enabled', true, ytRequests.map((r) => r.url).join(' '));
  check('Thumbnail request sends no referrer', ytRequests.every((r) => !r.referer));
  check('Only i.ytimg.com was contacted', thirdParty.length === 0, thirdParty.join(' '));

  // Cover on the Facebook reel
  const fb = page.locator('.card', { hasText: 'Linen apron reel' });
  await fb.locator('.edit-btn').click();
  [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('dialog button:has-text("Add cover image")')]);
  await chooser.setFiles(coverPng);
  await page.waitForSelector('dialog .cover-preview img');
  const coverInfo = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('save-library'); q.onsuccess = () => r(q.result); });
    const all = await new Promise((r) => { const q = db.transaction('covers').objectStore('covers').getAll(); q.onsuccess = () => r(q.result); });
    db.close();
    return all.map((c) => ({ bytes: c.bytes.byteLength, w: c.width, h: c.height, type: c.type }));
  });
  check('Cover resized and stored small', coverInfo.length === 2 && coverInfo.every((c) => c.h <= 480 && c.w <= 480 && c.bytes < 200 * 1024 && c.type === 'image/jpeg'), JSON.stringify(coverInfo));
  await page.click('dialog button:has-text("Save")');

  // Grid view
  await page.click('.segmented button:has-text("Grid")');
  await page.waitForSelector('.cards.grid .thumb img[src^="blob:"]');
  check('Cover visible in grid', true);
  check('No horizontal scroll (grid)', await noHScroll());
  await shot('03-grid-with-cover-and-youtube');

  // Offline: reload from the service worker, search + filters, cover still there, remote thumb falls back
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.card');
  check('Offline launch from service worker', true);
  check('Offline badge visible', await page.isVisible('#offline-badge'));
  await page.fill('input[type=search]', 'apron reel');
  await page.waitForTimeout(250);
  check('Offline search finds item', (await page.locator('.card').count()) === 1);
  await page.waitForSelector('.thumb img[src^="blob:"]');
  check('User cover shows offline', true);
  await page.fill('input[type=search]', '');
  await page.selectOption('select[aria-label=Platform]', 'youtube');
  await page.waitForTimeout(250);
  check('Offline: YouTube shows placeholder, not remote image', (await page.locator('.thumb img[src^="https://"]').count()) === 0);
  await page.selectOption('select[aria-label=Platform]', '');
  await page.selectOption('select[aria-label=Category]', { label: 'Sewing' });
  await page.waitForTimeout(150);
  check('Category filter', (await page.locator('.card').count()) === 1);
  await shot('04-offline-filtered');
  await ctx.setOffline(false);

  // Mixed Hebrew/English search
  await page.selectOption('select[aria-label=Category]', '');
  await page.fill('input[type=search]', 'מתכון');
  await page.waitForTimeout(250);
  check('Hebrew search', (await page.locator('.card').count()) === 1);
  await page.click('.segmented button:has-text("List")');
  await shot('05-hebrew-search-list');

  // Delete category → bookmarks back to Inbox
  await tab('Categories');
  await page.click('button[aria-label="Delete מתכונים"]');
  await tab('Inbox');
  check('Deleting category returns items to Inbox', (await page.locator('.card', { hasText: 'מתכון' }).count()) === 1);

  // Backup export (download fallback in Chromium) → restore into a fresh profile
  await tab('More');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export backup")')]);
  const backupPath = join(out, 'backup.json');
  await download.saveAs(backupPath);
  check('Backup exported', true, download.suggestedFilename());

  const ctx2 = await newContext();
  const p2 = await ctx2.newPage();
  p2.on('dialog', (d) => d.accept());
  await p2.goto(BASE);
  await p2.locator('.tabbar button', { hasText: 'More' }).click();
  [chooser] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('button:has-text("Restore backup")')]);
  await chooser.setFiles(backupPath);
  await p2.waitForSelector('dialog .stats');
  const rs = await p2.locator('dialog .stats strong').allTextContents();
  check('Restore preview (9 new)', rs[0] === '9', rs.join(','));
  await p2.click('dialog button:has-text("Add 9")');
  await p2.waitForSelector('.card');
  await p2.reload();
  await p2.waitForSelector('.card');
  await p2.waitForSelector('.thumb img[src^="blob:"]');
  check('Cover survives backup/restore and reload', true);
  const ann = await p2.locator('.card', { hasText: 'Linen apron reel' }).count();
  check('Annotations restored', ann === 1);
  // repeat restore is safe
  await p2.locator('.tabbar button', { hasText: 'More' }).click();
  [chooser] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('button:has-text("Restore backup")')]);
  await chooser.setFiles(backupPath);
  await p2.waitForSelector('dialog .stats');
  const rs2 = await p2.locator('dialog .stats strong').allTextContents();
  check('Repeat restore adds nothing', rs2[0] === '0' && rs2[1] === '9', rs2.join(','));
  await ctx2.close();

  // Responsiveness with 3,000 synthetic bookmarks (restored via a generated backup)
  const big = syntheticBackup(3000);
  const bigPath = join(out, 'synthetic-3000.json');
  writeFileSync(bigPath, JSON.stringify(big));
  const ctx3 = await newContext();
  const p3 = await ctx3.newPage();
  await p3.goto(BASE);
  await p3.locator('.tabbar button', { hasText: 'More' }).click();
  [chooser] = await Promise.all([p3.waitForEvent('filechooser'), p3.click('button:has-text("Restore backup")')]);
  let t0 = Date.now();
  await chooser.setFiles(bigPath);
  await p3.waitForSelector('dialog .stats');
  await p3.click('dialog button:has-text("Add 3000")');
  await p3.waitForSelector('.result-count:has-text("3000 items")');
  check('Restore 3,000 bookmarks', true, `${Date.now() - t0} ms`);
  t0 = Date.now();
  await p3.reload();
  await p3.waitForSelector('.result-count:has-text("3000 items")');
  const loadMs = Date.now() - t0;
  check('Reload with 3,000 bookmarks < 3 s', loadMs < 3000, `${loadMs} ms`);
  const searchMs = await p3.evaluate(async () => {
    const input = document.querySelector('input[type=search]');
    const t = performance.now();
    input.value = 'tote sewing';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => {
      const obs = new MutationObserver(() => {
        if (/of 3000/.test(document.querySelector('.result-count').textContent)) { obs.disconnect(); r(); }
      });
      obs.observe(document.querySelector('.result-count'), { childList: true, characterData: true, subtree: true });
    });
    return performance.now() - t - 120; // minus debounce
  });
  check('Search over 3,000 renders < 150 ms after debounce', searchMs < 150, `${searchMs.toFixed(1)} ms`);
  check('DOM stays small (paged rendering)', (await p3.locator('.card').count()) <= 60);
  await p3.fill('input[type=search]', '');
  await p3.click('.segmented button:has-text("Grid")');
  for (let i = 0; i < 5; i++) await p3.mouse.wheel(0, 3000);
  await p3.waitForTimeout(300);
  check('Infinite scroll loads more', (await p3.locator('.card').count()) > 60);
  check('No horizontal scroll (3,000, grid)', await p3.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await p3.screenshot({ path: join(out, '06-3000-grid.png') });
  await ctx3.close();

  check('No console errors (CSP etc.)', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (e) {
  check('Unexpected error', false, String(e?.stack ?? e));
  await shot('error').catch(() => undefined);
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${out}`);
process.exit(failed.length ? 1 : 0);

function syntheticBackup(n) {
  const T = ['Tote bag sewing tutorial', 'מתכון לעוגת שוקולד', 'Easy dinner recipe', 'Linen apron pattern', 'יוגה לבוקר', 'Home decor ideas', ''];
  const U = [
    (i) => `https://www.instagram.com/reel/SYN${i.toString(36)}/`,
    (i) => `https://www.facebook.com/reel/${100000 + i}`,
    (i) => `https://www.tiktok.com/@synthetic/video/${7000000000 + i}`,
    (i) => `https://www.pinterest.com/pin/${900000 + i}/`,
    (i) => `https://www.etsy.com/listing/${500000 + i}/synthetic-item`,
    (i) => `https://example.com/article/${i}`,
  ];
  const now = Date.now();
  return {
    format: 'save-library-backup', version: 1, exportedAt: new Date().toISOString(),
    categories: [{ id: 'c1', name: 'Sewing', createdAt: now }],
    bookmarks: Array.from({ length: n }, (_, i) => ({
      id: `s${i}`, url: U[i % U.length](i), savedAt: now - i * 60000, tags: i % 3 ? [] : ['ideas'],
      sharedText: T[i % T.length], title: i % 5 ? undefined : `Saved item ${i}`, categoryId: i % 4 ? null : 'c1',
    })),
  };
}
