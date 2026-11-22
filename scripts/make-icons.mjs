// Renders public/icons/icon.svg to the PNG sizes iOS/Android need, using the preinstalled Playwright.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }
const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await playwright.chromium.launch();
const page = await browser.newPage();
async function render(size, file, { maskable = false, square = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = maskable ? svg.replace('rx="112"', 'rx="0"').replace('viewBox="0 0 512 512"', 'viewBox="-64 -64 640 640"') : square ? svg.replace('rx="112"', 'rx="0"') : svg;
  const bg = maskable ? '#211d33' : 'transparent';
  await page.setContent(`<html><body style="margin:0;background:${bg}">${inner.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(new URL(`../public/icons/${file}`, import.meta.url), await page.screenshot({ omitBackground: !maskable }));
}
await render(180, 'apple-touch-icon.png', { square: true }); // iOS rounds corners itself
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'maskable-512.png', { maskable: true });
await browser.close();
console.log('icons written');
