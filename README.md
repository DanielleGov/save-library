# Save Library

A private, offline-first bookmark library for iPhone. Save Instagram, Facebook and TikTok reels and videos (plus YouTube, Pinterest, Etsy and any website) from the share sheet, organize them later, find them by text or by sight, and open the original at its source.

- **No backend, accounts, analytics or trackers.** The library lives in IndexedDB in the installed web app on your phone.
- **Capture:** an iOS Shortcut, **Save to Library**, writes one small capture file per share into a Files folder. In the app, **Import Shortcut Inbox** shows a preview, then adds the captures. Duplicates are skipped, so importing the same files twice is safe.
- **Copy Link → Add Link → Paste** always works as well. **Paste many** takes a batch of links.
- **Thumbnails:** you can add a cover image (for example a screenshot) to any bookmark. YouTube previews can be turned on if you want them. Everything else shows a clear platform/type placeholder.

> Status: the app, importer and tests are built and pass in Chromium with iPhone emulation. **The Shortcut recipe and every iPhone-specific step still need checking on a real iPhone.** See [Manual iPhone checks](#manual-iphone-checks-pending).

---

## Contents

1. [Local development (Windows, macOS, Linux)](#local-development)
2. [Deploying over HTTPS (free)](#deploying-over-https-free-tier)
3. [iPhone setup: install the app](#iphone-setup-1--install-the-web-app)
4. [iPhone setup: the Save to Library Shortcut](#iphone-setup-2--the-save-to-library-shortcut)
5. [iPhone setup: importing](#iphone-setup-3--import-into-the-library)
6. [Capture file format](#capture-file-format)
7. [How links are handled](#how-links-are-handled)
8. [Thumbnails and covers](#thumbnails-and-covers)
9. [Storage, backups and limits](#storage-backups-and-limits)
10. [Privacy](#privacy)
11. [Tests](#tests)
12. [Manual iPhone checks (pending)](#manual-iphone-checks-pending)
13. [Follow-up work](#follow-up-work)

---

## Local development

Requirements: Node.js 20 or newer (22 LTS recommended). On Windows, PowerShell or Windows Terminal is fine.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The dev server does not register the service worker. Your data goes into that browser's IndexedDB for `localhost`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm test` | Unit tests (Vitest + fake-indexeddb) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` | Typecheck and production build to `dist/` (includes `sw.js` and the CSP) |
| `npm run preview` | Serve the production build locally (service worker active on localhost) |
| `npm run e2e` | Build, then drive the app in Chromium with iPhone emulation (uses a preinstalled Playwright; see [Tests](#tests)) |
| `npm run icons` | Regenerate PNG icons from `public/icons/icon.svg` (needs Playwright) |

**Trying it on your phone during development:** `npm run dev` listens on your LAN (`http://<your-PC-IP>:5173`), and you can open that from Safari to check layout. A service worker and a standalone install need HTTPS, though, so do offline and Home Screen tests against an HTTPS deployment. While developing, use synthetic links only. The fixtures in `fixtures/` are synthetic.

## Deploying over HTTPS (free tier)

The build is a static folder (`dist/`) that works from any path, because it uses relative URLs. Any free static host with HTTPS will do. **Nothing is published automatically. Deploy only when you decide to.**

**Option A — Cloudflare Pages or Netlify (drag & drop):**

1. Run `npm run build`.
2. Create a Pages/Netlify site and upload the `dist` folder (or connect the repo with build command `npm run build` and output `dist`).
3. Open the `https://…` URL it gives you.

**Option B — GitHub Pages:** push the repo, then add a workflow that runs `npm ci && npm run build` and uploads `dist` with `actions/upload-pages-artifact` + `actions/deploy-pages`. Under Settings → Pages, set Source to "GitHub Actions". The app works at `https://<user>.github.io/<repo>/`.

Notes:
- Each deployment URL (origin) has its **own separate library**. Don't move hosts without exporting a backup first.
- The app sets a strict Content-Security-Policy through a `<meta>` tag at build time. Images may come only from the app itself, from `blob:`/`data:` (covers), and from `https://i.ytimg.com`. If your host lets you set headers, you can also send `Referrer-Policy: no-referrer`.
- Updates: the service worker uses network-first for the page and a versioned shell cache. After you deploy, close and reopen the Home Screen app (sometimes twice) to pick up the new version.

## iPhone setup 1 — Install the web app

1. On the iPhone, open **Safari** (not an in-app browser) and go to your HTTPS deployment URL.
2. Tap the **Share** button (square with arrow).
3. Scroll and tap **Add to Home Screen**. If it isn't there, tap **Edit Actions…** and add it.
4. Make sure **Open as Web App** is on (iOS 18+), keep the name **Library**, and tap **Add**.
5. Open **Library** from the Home Screen. **From now on, always use the Home Screen icon.** The installed app has its own storage, separate from Safari tabs.
6. Optional: go to **More → Storage → Ask to keep data**.
7. Turn on Airplane Mode and open the app again. It should launch and show your library. Then turn Airplane Mode off.

## iPhone setup 2 — The Save to Library Shortcut

This Shortcut queues each share as one small JSON file in a Files folder. It never opens Safari or the web app, and it does not need a server.

### 2a. Create the inbox folder (on-device, recommended)

1. Open the **Files** app → **Browse** → **On My iPhone**.
2. Long-press an empty area (or tap **⋯**), choose **New Folder**, and name it **Save Library Inbox**.

> **Alternative: iCloud Drive.** You can create the folder under **iCloud Drive** instead (for example `iCloud Drive/Shortcuts/Save Library Inbox`). Captures then **sync to Apple's servers and your other devices**. That is handy if you save on an iPad, but it is no longer on-device only. Also, offline shares may sit in the upload queue, and Files may need to download them before you can import. Use it only if you want that sync.

### 2b. Build the Shortcut

Action names are from iOS 17/18 in English. Use the search field at the bottom of the action list to find each one.

1. Open **Shortcuts** → **+** (new shortcut). Tap the name at the top and rename it **Save to Library**.
2. Tap the **ⓘ** (or the down-arrow by the name → **Details**) and turn on **Show in Share Sheet**. Tap **Done**.
3. A block now appears at the top that reads **Receive _Any_ input from _Share Sheet_**. On recent iOS versions it may instead read **Receive _Apps and 18 more_ from _Share Sheet_** (the number can vary). Either way, it's the same block. Tap the underlined input types (**Any** / **Apps and 18 more**), tap **Clear** (or deselect everything), select only **URLs** and **Text**, then tap **Done**. The block should then read **Receive _URLs and Text_ from _Share Sheet_**. Images, videos and other media are not accepted. Tap **If there's no input** and choose **Stop and Respond**, with the response *No link found*.
4. Add **Get URLs from Input**. Its input should be **Shortcut Input**.
5. Add **If**. Set it to **URLs** **does not have any value**. Inside the If:
   - add **Show Alert** with the text *No link found — nothing was queued.* (turn off **Show Cancel Button**),
   - add **Stop This Shortcut**.
   Leave **Otherwise** empty. (You can delete the Otherwise branch.)
6. After **End If**, add **Combine Text**. Combine **URLs** with **New Lines**.
7. Add **Get Text from Input** with **Shortcut Input**. This keeps any caption or text the app shared.
8. Add **Format Date**. Date: **Current Date**, Date Format: **ISO 8601**, and turn on **Include ISO 8601 Time**. Rename its output to `CreatedAt` (tap the variable → Rename).
9. Add **Format Date** again. Date: **Current Date**, Date Format: **Custom**, Format String `yyyyMMdd-HHmmss`. Rename its output to `Stamp`.
10. Add **Random Number** with Minimum `1000` and Maximum `9999`.
11. Add **Dictionary** and add these items in this order (use **Add new item** and pick the type shown):

    | Type | Key | Value |
    | --- | --- | --- |
    | Text | `format` | `save-library-capture` |
    | Number | `v` | `1` |
    | Text | `id` | `Stamp`-`Random Number` (insert both variables with a `-` between them) |
    | Text | `createdAt` | `CreatedAt` |
    | Text | `urls` | `Combined Text` |
    | Text | `text` | `Text` (from Get Text from Input) |

12. Add **Set Name**. Set the name of **Dictionary** to `capture-` `Stamp` `-` `Random Number` `.json`. Leave **Don't Include File Extension** off.
13. Add **Save File** (input: **Renamed Item**). Tap the arrow to expand it:
    - turn **Ask Where to Save** **off**,
    - tap **Shortcuts** (the destination) and pick **On My iPhone → Save Library Inbox**,
    - leave **Overwrite If File Exists** **off**.
14. Add **If**. Set it to **Saved File** **has any value**. Inside: **Show Notification** with the text *Queued — import it in Library when convenient.* Under **Otherwise**: **Show Alert** with the text *Could not queue this link.* Because Save File stops the Shortcut when the write fails, **Queued** only appears after a successful write.
15. Tap **Done**.

**First run:** share any link to **Save to Library**. iOS may ask to let the Shortcut save to the folder and to send notifications. Choose **Always Allow** / **Allow**. After that, saving to the on-device folder should not prompt again. *(Pending real-device check, see below.)*

### 2c. Using it

- In Instagram / Facebook / TikTok / YouTube / Pinterest / Etsy / Safari: **Share** → (swipe to **More** if needed) → **Save to Library**. You should see **Queued**.
- To move it to the front: in the share sheet, scroll the app row to the end → **More** → **Edit** → drag **Save to Library** up or add it to Favorites.
- If an app has no share sheet option (some only offer **Copy Link**), copy the link, open **Library** → **+ Add Link** → **Paste**.

## iPhone setup 3 — Import into the library

1. Open **Library** from the Home Screen → **More** → **Import Shortcut Inbox**. (When the library is empty, the button is also on the home view.)
2. The Files picker opens. Go to **On My iPhone → Save Library Inbox**, tap **Select**, select all the capture files, and tap **Open**.
3. Check the preview: **new / duplicates / invalid**, plus any skipped files with a reason. Tap **Add N**.
4. New items arrive in the **Inbox** tab. There you can accept a suggested category, ignore it, or pick another one.
5. Optional: delete the imported files in Files. The web app cannot delete them for you, because it never gets ongoing access to Files. Importing them again later is safe: captures it has already seen, and links already in the library, are counted as duplicates.

If the picker greys out the capture files (iOS file-type matching), report it. The fallback is to change the Shortcut's file name to end in `.txt`. The importer accepts plain-text files that contain links as well.

## Capture file format

One UTF-8 JSON file per share (`fixtures/shortcut-inbox/` has examples):

```json
{
  "format": "save-library-capture",
  "v": 1,
  "id": "20261122-101500-4821",
  "createdAt": "2026-11-22T10:15:00+02:00",
  "urls": "https://www.instagram.com/reel/SYNTHETIC0001/?igsh=abc123",
  "text": "Easy tote bag sewing tutorial 🧵 https://www.instagram.com/reel/SYNTHETIC0001/?igsh=abc123"
}
```

- `urls`: newline-separated text, or an array. Links in `text` are also picked up.
- `id`: used to recognize repeat imports. If it is missing, an id is derived from the content.
- The URLs are removed from `text`, and what remains becomes the bookmark's **shared text** (plain text, max 2,000 characters).
- `.txt` files containing links are accepted as a fallback. Files over 64 KB are rejected, and so are newer `v` values, backups, and files without a valid link.
- The format is platform-neutral, so an Android share target can write the same files later.

## How links are handled

- **Validation (every route: Add Link, paste, Shortcut import, backup restore):** only `http(s)` is accepted. Links with embedded credentials (`user:pass@`), whitespace/control characters, single-label hosts, and links over 2,048 characters are rejected. The original link is stored exactly as received and is what opens.
- **Platform:** detected by exact host or a real subdomain (`notinstagram.com` and `instagram.com.evil.example` are *not* Instagram).
- **Type:** inferred only from clear URL patterns: Instagram `/reel/` → Reel, `/p/` → Post; Facebook `/reel/`, `/share/r/` → Reel, `/share/v/`, `/watch`, `/videos/` → Video; TikTok `/@user/video/` → Video; YouTube `/shorts/` → Short, `watch?v=`/`youtu.be` → Video; Pinterest `/pin/` → Pin; Etsy `/listing/` → Listing. Anything else is **Unknown**, and you can change it in **Edit**.
- **Short links** (`vm.tiktok.com`, `pin.it`, `fb.watch`, `etsy.me` …) are **never resolved**. The app makes no network request for your links.
- **Duplicates** use a separate key. It drops share-tracking parameters (`utm_*`, `igsh`, `fbclid`, `si`, `mibextid`, `_t`, …), `www.`/`m.` prefixes, fragments and trailing slashes, and sorts the remaining parameters. Where a content id is clear (Instagram shortcode, YouTube id, TikTok video id, Pinterest pin, Etsy listing, Facebook reel), the key uses that id. Meaningful parameters are kept.

**Category suggestions** come from a small on-device keyword matcher. It uses the shared text, title, note and tags, and matches your own category names plus a built-in English/Hebrew vocabulary for Sewing, Recipes, Home & Decor, Fitness, Crafts and Travel. When nothing fits, it can offer to create a category. Links with no meaningful text stay in the Inbox without a suggestion.

**Search** covers the text the app actually has: title, shared text, note, tags, category name, URL host/path, platform and type. It is case- and accent-insensitive, ignores Hebrew niqqud, treats final letters (ם/מ, ן/נ …) as equal, and requires every search word to match. Hebrew and mixed text display with automatic direction.

## Thumbnails and covers

| Source | Status |
| --- | --- |
| **Your cover image** | **Edit → Add cover image** on any bookmark. Pick a screenshot or photo, and it is resized on-device to at most 480 px and re-encoded as JPEG (which strips EXIF/GPS metadata). Only that small copy (under 200 KB) is stored, in IndexedDB. You can replace or remove it. Covers work offline and are included in backups. |
| **YouTube** | Optional (**More → Previews**, off by default). The thumbnail URL is built from a validated 11-character video id: `https://i.ytimg.com/vi/<id>/mqdefault.jpg`. It needs no API key. Images load only when a card is near the screen, with no referrer. They are not stored in IndexedDB and not cached by the service worker. Offline, or when an image fails, the placeholder stays. |
| **TikTok** | Not used. TikTok's oEmbed returns signed, expiring CDN thumbnail URLs and needs a cross-origin JSON request. Whether that works from the deployed app without a proxy could not be verified from this build environment (network access to tiktok.com was blocked), so it is left out. |
| **Instagram / Facebook** | Not available. Meta's oEmbed no longer returns thumbnails. The app uses a placeholder, or your cover. No scraping, embeds or media downloads. |

The CSP `img-src` allows only `https://i.ytimg.com` as a remote image origin, so arbitrary URLs from imports can never load as images.

## Storage, backups and limits

- **Where data lives:** IndexedDB inside the installed Home Screen app on this iPhone. Safari tabs, other browsers and other devices **cannot see it**. Apple says Home Screen web apps are not subject to Safari's 7-day storage cap, but **deleting the Home Screen app, or clearing website data in Settings → Safari, erases the library.** iOS may also evict data under severe storage pressure.
- **Backups:** **More → Export backup** creates `save-library-backup-YYYY-MM-DD.json` and opens the share sheet. Choose **Save to Files**. On desktop browsers it downloads instead. **Restore backup** validates the file and shows a preview (added / duplicates / invalid). Bookmarks you already have keep their notes and categories unchanged, so restoring twice is safe. Categories are merged by name.
- **Backup format:** `{ "format": "save-library-backup", "version": 2, "exportedAt", "categories": [...], "bookmarks": [...], "covers": { "<bookmarkId>": { "dataUrl", "width", "height" } } }`. Version 1 (no covers) is still accepted. Every field is validated again on restore. Covers must be base64 JPEG/PNG/WebP data URLs under 200 KB with a matching file signature.
- **Limits:** capture files 64 KB each, at most 500 per import. Bulk paste: 500,000 characters / 5,000 links. Backups: 40 MB and 50,000 bookmarks. Covers: 30 MB input, 200 KB stored. Text fields are capped (title 300, note 5,000, shared text 2,000, 30 tags).

## Privacy

- The bookmark collection stays on the device. There is no account, custom backend, paid API, analytics, third-party trackers or social login.
- The app never fetches or caches pages, videos, audio or full-size images from the platforms. The only network request it can make for your bookmarks is the opt-in YouTube thumbnail.
- Tapping a bookmark opens the original link normally, with `noopener noreferrer`. The app never opens a post on its own and never puts links in its own URL.
- Shared text, titles and notes are treated as untrusted plain text. They are rendered with `textContent` and never as HTML. Nothing is logged.

## Tests

```bash
npm test
```

98 unit tests (Vitest), covering:
- `tests/url.test.ts`: URL validation, extraction, platform/type inference, short links, YouTube id validation, deduplication keys.
- `tests/importer.test.ts`: Shortcut capture fixtures (valid, multi-link, plain text, no link, invalid links), repeat imports, in-batch duplicates, bulk paste, backup round trip with covers, v1 backups, unsafe covers, version/format rejection.
- `tests/search.test.ts`: English, Hebrew (niqqud, final letters), mixed text, filters, category names, and 5,000-bookmark search speed.
- `tests/suggest.test.ts`: suggestions in English and Hebrew, user category names, new-category suggestions, and the opaque-link / unrelated-text fallbacks.
- `tests/db.test.ts`: IndexedDB persistence across reopen (bookmarks, edits, categories, covers, settings, imported capture ids), no duplicates, deleting a category returns items to the Inbox, 3,000-bookmark load.
- `tests/thumbs.test.ts`: allowed thumbnail origins.

```bash
npm run e2e
```

This builds the app and drives it in Chromium with iPhone 13 emulation. It needs Playwright with Chromium available (`npm i -D playwright && npx playwright install chromium` if you don't already have it). Screenshots go to `.e2e-output/`. It checks: install/service worker, Add Link validation and duplicates, the multi-file Shortcut import with preview and repeat import, suggestions (Sewing, מתכונים), bulk paste, YouTube previews off/on with no referrer and no other third-party requests, the cover resize, grid view, an offline relaunch with search/filters and covers, Hebrew search, category deletion, backup → restore into a fresh profile (cover kept, repeat restore safe), and 3,000 bookmarks (restore time, reload time, search time, paged rendering, no horizontal scroll). YouTube image requests are answered with a synthetic image because this environment cannot reach i.ytimg.com.

**Browser tests don't prove iPhone behavior.** Safari/WebKit, the share sheet, Shortcuts, Files and specific apps are not exercised.

## Manual iPhone checks (pending)

None of these have been run yet. Record the results here.

| # | Check | Result |
| --- | --- | --- |
| 1 | Add to Home Screen; app opens standalone; relaunch in Airplane Mode works | ☐ |
| 2 | Shortcut appears in the share sheet for URLs and Text; Save File to **On My iPhone** works without prompting after the first **Always Allow** | ☐ |
| 3 | The Dictionary saves as valid `.json` with the expected keys (open the file in Files → Quick Look) | ☐ |
| 4 | **Instagram reel** → Share → Save to Library: share sheet available? URL or link-bearing text? **Queued**? Imports into the **Home Screen** app? | ☐ |
| 5 | **Facebook reel / saved post** → same questions (Facebook often only offers Copy Link; note which) | ☐ |
| 6 | **TikTok video** → same questions (TikTok usually shares a `vm.tiktok.com` short link plus text) | ☐ |
| 7 | Sharing a page with no link (e.g. plain text) shows **No link found** and writes nothing | ☐ |
| 8 | Offline capture: Airplane Mode → share → **Queued** → later import works | ☐ |
| 9 | Files picker shows the capture files (not greyed out) and multi-select works | ☐ |
| 10 | Repeat import of the same files reports duplicates and adds nothing | ☐ |
| 11 | Tapping a bookmark opens the original app/site when online | ☐ |
| 12 | Add a cover from Photos (HEIC) to an Instagram/Facebook bookmark; it shows in Grid offline | ☐ |
| 13 | YouTube preview loads with previews enabled; placeholder offline | ☐ |
| 14 | Export backup → Save to Files → Restore in a fresh install | ☐ |
| 15 | Hebrew captions display right-to-left correctly and are searchable | ☐ |

**First demo script:** install (1) → share a reel (4) → import (9) → accept or create a category in the Inbox → Airplane Mode → search and filter for it → turn Airplane Mode off and tap to open the original → More → Previews on → see a YouTube thumbnail → add a cover to an Instagram/Facebook bookmark → Grid view offline, find it by sight → **+ Add Link → Paste**.

## Follow-up work

- **Historical saves from Facebook / Instagram / TikTok:** request the official data exports and share *redacted* samples. Write a source-specific importer only after confirming which saved-item links the exports actually contain (URLs and text only).
- **Saving straight into the library without a separate import** would need an optional authenticated HTTPS capture service: the Shortcut posts to your own endpoint, and the app syncs from it. That adds a server that sees your links, needs authentication and hosting, and makes capture depend on the network. It is deliberately not part of this build.
- **Android:** the data model, capture format and backup format are platform-neutral. A Web Share Target in the manifest could add direct sharing on Android.

## Project layout

```
index.html               App shell (CSP injected at build)
src/main.ts              UI: library, inbox, categories, dialogs, import/backup flows
src/styles.css           Dark theme, responsive, accessible, RTL-aware styles
src/ui/icons.ts          Inline SVG icon set
src/lib/url.ts           Validation, extraction, platform/type inference, dedup keys
src/lib/importer.ts      Capture files, bulk paste, import planning, backup/restore
src/lib/db.ts            IndexedDB store (bookmarks, categories, covers, settings, imported captures)
src/lib/search.ts        Normalized text search + filters
src/lib/suggest.ts       On-device category suggestions (EN/HE)
src/lib/thumbs.ts        Allowed remote thumbnail sources (YouTube only)
src/lib/cover.ts         On-device cover resize/re-encode
sw/sw.js                 Service worker template (app shell only)
vite.config.ts           Build: CSP meta + generated precache list
fixtures/shortcut-inbox  Synthetic Shortcut capture files
tests/                   Unit tests
scripts/e2e.mjs          Browser end-to-end check (iPhone emulation)
```
