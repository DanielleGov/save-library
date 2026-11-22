import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Content-Security-Policy for the built app. img-src allows only this app, covers (blob:/data:)
 * and the provider thumbnail origin listed in src/lib/thumbs.ts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data: https://i.ytimg.com",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

/** Emits sw.js with a precache list of every built file (app shell + own static assets only). */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'app-shell-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const publicFiles = ['manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png'];
      const precache = ['./', ...[...new Set(['index.html', ...files, ...publicFiles])].map((f) => './' + f)];
      const version = createHash('sha256').update(precache.join('\n') + JSON.stringify(Object.values(bundle).map((b) => ('code' in b ? b.code.length : 0)))).digest('hex').slice(0, 12);
      const src = readFileSync(new URL('./sw/sw.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [cspPlugin(), serviceWorkerPlugin()],
  build: { target: 'es2021', sourcemap: false },
  server: { host: true },
  preview: { host: true },
});
