import './styles.css';
import { makeCover } from './lib/cover';
import { LibraryStore } from './lib/db';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  capturesToCandidates,
  encodeDataUrl,
  isCapture,
  newBookmark,
  parseBackup,
  parseBulkText,
  parseCaptureFile,
  planImport,
  planRestore,
  type BackupFile,
  type Capture,
  type FileProblem,
  type ImportPlan,
} from './lib/importer';
import { categoryNameLookup, EMPTY_FILTERS, searchBookmarks, SearchIndex, type Filters } from './lib/search';
import { suggestCategory, type Suggestion } from './lib/suggest';
import { cleanTags, cleanText } from './lib/text';
import { remoteThumbUrl } from './lib/thumbs';
import {
  LIMITS,
  MEDIA_LABELS,
  MEDIA_TYPES,
  PLATFORM_LABELS,
  PLATFORMS,
  type Bookmark,
  type MediaType,
  type Platform,
} from './lib/types';
import { analyzeLink, displayUrl } from './lib/url';
import { $, clear, h, pickFiles, readFileText, toast } from './ui/dom';

type View = 'library' | 'inbox' | 'categories' | 'more';
const PAGE = 60;
const PLATFORM_GLYPH: Record<Platform, string> = {
  instagram: 'IG', facebook: 'f', tiktok: 'TT', youtube: '▶', pinterest: 'P', etsy: 'E', other: '🔗',
};

let store: LibraryStore;
let index: SearchIndex;
const state: { view: View; filters: Filters; shown: number } = { view: 'library', filters: { ...EMPTY_FILTERS }, shown: PAGE };
const coverUrls = new Map<string, string>();
const main = () => $('#main');
const dialog = () => document.getElementById('dialog') as HTMLDialogElement;

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot(): Promise<void> {
  try {
    store = await LibraryStore.open();
  } catch (e) {
    main().append(h('p', { class: 'error' }, 'Could not open local storage. Private Browsing may block it. ', String(e)));
    return;
  }
  index = new SearchIndex(categoryNameLookup(store.categories));
  store.onChange(() => updateInboxCount());
  document.querySelectorAll<HTMLButtonElement>('.tabbar button').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.view as View)),
  );
  $('#add-btn').addEventListener('click', () => openAddDialog());
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
  updateInboxCount();
  render();
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }
}

function updateOnline(): void {
  ($('#offline-badge') as HTMLElement).hidden = navigator.onLine;
}

function updateInboxCount(): void {
  const n = store.bookmarks.filter((b) => b.categoryId === null).length;
  $('#inbox-count').textContent = n ? `(${n})` : '';
}

/** Rebuild the search cache (category names feed the searchable text). */
function reindex(): void {
  index = new SearchIndex(categoryNameLookup(store.categories));
}

function go(view: View, filters?: Partial<Filters>): void {
  state.view = view;
  state.shown = PAGE;
  if (filters) state.filters = { ...EMPTY_FILTERS, ...filters };
  document.querySelectorAll<HTMLButtonElement>('.tabbar button').forEach((b) => {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  render();
  window.scrollTo(0, 0);
}

function render(): void {
  const titles: Record<View, string> = { library: 'Library', inbox: 'Inbox', categories: 'Categories', more: 'More' };
  $('#view-title').textContent = titles[state.view];
  document.title = `${titles[state.view]} · Save Library`;
  const m = main();
  clear(m);
  if (state.view === 'library') renderLibrary(m, false);
  else if (state.view === 'inbox') renderLibrary(m, true);
  else if (state.view === 'categories') renderCategories(m);
  else renderMore(m);
}

/* ------------------------------------------------------------------ */
/* Library / Inbox                                                     */
/* ------------------------------------------------------------------ */

function option(value: string, label: string, selected: boolean): HTMLOptionElement {
  return h('option', { value, selected }, label);
}

function renderLibrary(m: HTMLElement, inbox: boolean): void {
  const f = state.filters;
  const search = h('input', {
    type: 'search', class: 'search', dir: 'auto', value: f.query, enterkeyhint: 'search', autocomplete: 'off',
    placeholder: inbox ? 'Search the Inbox' : 'Search titles, text, notes, tags',
    'aria-label': 'Search bookmarks',
  });
  search.value = f.query;
  let t: number | undefined;
  search.addEventListener('input', () => {
    window.clearTimeout(t);
    t = window.setTimeout(() => {
      f.query = search.value;
      state.shown = PAGE;
      renderResults();
    }, 120);
  });

  const platformSel = h('select', { 'aria-label': 'Platform' },
    option('', 'All', !f.platform),
    PLATFORMS.map((p) => option(p, PLATFORM_LABELS[p], f.platform === p)));
  const typeSel = h('select', { 'aria-label': 'Media type' },
    option('', 'All', !f.mediaType),
    MEDIA_TYPES.map((t) => option(t, MEDIA_LABELS[t], f.mediaType === t)));
  const catSel = h('select', { 'aria-label': 'Category' },
    option('', 'All', !f.category),
    option('inbox', 'Inbox', f.category === 'inbox'),
    store.categories.map((c) => option(c.id, c.name, f.category === c.id)));
  platformSel.addEventListener('change', () => { f.platform = platformSel.value as Platform | ''; state.shown = PAGE; renderResults(); });
  typeSel.addEventListener('change', () => { f.mediaType = typeSel.value as MediaType | ''; state.shown = PAGE; renderResults(); });
  catSel.addEventListener('change', () => { f.category = catSel.value; state.shown = PAGE; renderResults(); });

  const filters = h('div', { class: 'filters' },
    h('label', {}, 'Platform', platformSel),
    h('label', {}, 'Type', typeSel),
    inbox ? null : h('label', {}, 'Category', catSel));
  if (inbox) filters.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';

  const view = store.settings.view;
  const listBtn = h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(view === 'list') }, 'List');
  const gridBtn = h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(view === 'grid') }, 'Grid');
  const setView = async (v: 'list' | 'grid') => {
    await store.saveSettings({ view: v });
    listBtn.setAttribute('aria-pressed', String(v === 'list'));
    gridBtn.setAttribute('aria-pressed', String(v === 'grid'));
    renderResults();
  };
  listBtn.addEventListener('click', () => setView('list'));
  gridBtn.addEventListener('click', () => setView('grid'));

  const count = h('p', { class: 'result-count', 'aria-live': 'polite' });
  const toolbar = h('div', { class: 'toolbar' }, count, h('div', { class: 'row', role: 'group', 'aria-label': 'Layout' }, listBtn, gridBtn));
  const results = h('div', { id: 'results' });
  m.append(search, filters, toolbar, results);

  function renderResults(): void {
    const filters: Filters = inbox ? { ...f, category: 'inbox' } : f;
    const found = searchBookmarks(store.bookmarks, filters, index);
    const total = inbox ? store.bookmarks.filter((b) => b.categoryId === null).length : store.bookmarks.length;
    count.textContent =
      found.length === total ? `${total} ${total === 1 ? 'item' : 'items'}` : `${found.length} of ${total}`;
    clear(results);
    if (!store.bookmarks.length) {
      results.append(emptyLibrary());
      return;
    }
    if (!found.length) {
      results.append(h('p', { class: 'empty' }, inbox && total === 0 ? 'Inbox is empty — everything is organized.' : 'No matches. Try fewer words or clear a filter.'));
      return;
    }
    const ul = h('ul', { class: `cards ${store.settings.view}` });
    const cats = store.categories;
    for (const b of found.slice(0, state.shown)) ul.append(card(b, inbox ? suggestCategory(b, cats) : null, inbox));
    results.append(ul);
    if (found.length > state.shown) {
      const more = h('button', { type: 'button', class: 'btn' }, `Show more (${found.length - state.shown} left)`);
      more.addEventListener('click', () => {
        state.shown += PAGE * 2;
        renderResults();
      });
      const wrap = h('div', { class: 'more-wrap' }, more);
      results.append(wrap);
      // auto-load when the button scrolls into view
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          state.shown += PAGE * 2;
          renderResults();
        }
      }, { rootMargin: '600px' });
      io.observe(wrap);
    }
    observeThumbs(results);
  }
  renderResults();
  rerenderResults = renderResults;
}
let rerenderResults: () => void = () => undefined;

function emptyLibrary(): HTMLElement {
  return h('div', { class: 'empty' },
    h('p', {}, 'Your library is empty.'),
    h('p', {}, 'Add a link, paste several, or import captures from the Save to Library Shortcut.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => openAddDialog() }, 'Add Link'),
      h('button', { type: 'button', class: 'btn', onclick: () => importShortcutInbox() }, 'Import Shortcut Inbox')));
}

function displayTitle(b: Bookmark): string {
  if (b.title) return b.title;
  if (b.sharedText) return b.sharedText.split('\n').find((l) => l.trim()) ?? displayUrl(b.url);
  return displayUrl(b.url);
}

function card(b: Bookmark, suggestion: Suggestion | null, inbox: boolean): HTMLLIElement {
  const catName = b.categoryId ? store.categories.find((c) => c.id === b.categoryId)?.name : undefined;
  const title = displayTitle(b);
  const thumb = h('div', { class: 'thumb', 'data-thumb': b.id });
  thumb.append(placeholder(b));
  const sub = [PLATFORM_LABELS[b.platform], MEDIA_LABELS[b.mediaType], catName ?? (inbox ? null : 'Inbox')]
    .filter(Boolean)
    .join(' · ');
  const li = h('li', { class: 'card' },
    h('a', { class: 'card-open', href: b.url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
      'aria-label': `Open original: ${title} (${PLATFORM_LABELS[b.platform]} ${MEDIA_LABELS[b.mediaType]})` },
      thumb,
      h('div', { class: 'meta' },
        h('span', { class: 'title', dir: 'auto' }, title),
        h('span', { class: 'sub', dir: 'auto' }, sub))),
    h('button', { type: 'button', class: 'edit-btn', 'aria-label': `Edit ${title}`, onclick: () => openEditDialog(b.id) }, 'Edit'));
  if (inbox) li.append(inboxRow(b, suggestion));
  return li;
}

function inboxRow(b: Bookmark, s: Suggestion | null): HTMLElement {
  const row = h('div', { class: 'suggest' });
  if (s && !b.suggestDismissed) {
    const accept = h('button', { type: 'button', class: 'btn small primary' },
      s.kind === 'existing' ? `Move to ${s.name}` : `Create “${s.name}”`);
    accept.addEventListener('click', async () => {
      const cat = s.kind === 'existing' ? { id: s.categoryId } : await store.addCategory(s.name);
      if (s.kind === 'new') reindex();
      await store.updateBookmark(b.id, { categoryId: cat.id });
      index.invalidate(b.id);
      toast(`Moved to ${s.name}`);
      rerenderResults();
    });
    const ignore = h('button', { type: 'button', class: 'btn small' }, 'Ignore');
    ignore.addEventListener('click', async () => {
      await store.updateBookmark(b.id, { suggestDismissed: true });
      rerenderResults();
    });
    row.append(h('span', {}, 'Suggested:'), accept, ignore);
  }
  const sel = h('select', { 'aria-label': `Move ${displayTitle(b)} to category` },
    option('', s && !b.suggestDismissed ? 'Other…' : 'Move to…', true),
    store.categories.map((c) => option(c.id, c.name, false)),
    option('__new', '+ New category…', false));
  sel.addEventListener('change', async () => {
    let id = sel.value;
    if (id === '__new') {
      const name = cleanText(window.prompt('New category name') ?? '', LIMITS.categoryName);
      if (!name) {
        sel.value = '';
        return;
      }
      id = (await store.addCategory(name)).id;
      reindex();
    }
    await store.updateBookmark(b.id, { categoryId: id });
    index.invalidate(b.id);
    toast('Moved');
    rerenderResults();
  });
  row.append(sel);
  return row;
}

function placeholder(b: Bookmark): HTMLElement {
  return h('div', { class: `placeholder p-${b.platform}`, role: 'img',
    'aria-label': `${PLATFORM_LABELS[b.platform]} ${MEDIA_LABELS[b.mediaType]}, no preview` },
  h('div', {}, h('div', { class: 'glyph' }, PLATFORM_GLYPH[b.platform]), h('div', { class: 'ptype' }, MEDIA_LABELS[b.mediaType])));
}

/* Thumbnails: covers from IndexedDB, or (opt-in) provider thumbnails — only near the viewport. */
let thumbObserver: IntersectionObserver | null = null;
function observeThumbs(root: HTMLElement): void {
  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      thumbObserver?.unobserve(e.target);
      void fillThumb(e.target as HTMLElement);
    }
  }, { rootMargin: '400px 0px' });
  root.querySelectorAll<HTMLElement>('[data-thumb]').forEach((el) => thumbObserver!.observe(el));
}

async function fillThumb(el: HTMLElement): Promise<void> {
  const b = store.get(el.dataset.thumb ?? '');
  if (!b) return;
  if (b.hasCover) {
    const url = await coverObjectUrl(b.id);
    if (url) {
      setThumbImg(el, url, `Cover image for ${displayTitle(b)}`);
      return;
    }
  }
  const remote = store.settings.remoteThumbnails && navigator.onLine ? remoteThumbUrl(b) : null;
  if (remote) setThumbImg(el, remote, `${PLATFORM_LABELS[b.platform]} preview for ${displayTitle(b)}`, true);
}

function setThumbImg(el: HTMLElement, src: string, alt: string, remote = false): void {
  // Not attached until loaded, so the IntersectionObserver (not loading="lazy") does the lazy part.
  const img = h('img', { alt, decoding: 'async', referrerpolicy: 'no-referrer' });
  if (remote) img.dataset.remote = '1';
  img.addEventListener('load', () => {
    clear(el);
    el.append(img);
  }, { once: true });
  // On error (private, expired, offline) the placeholder simply stays.
  img.src = src;
}

async function coverObjectUrl(id: string): Promise<string | null> {
  const cached = coverUrls.get(id);
  if (cached) return cached;
  const c = await store.getCover(id);
  if (!c) return null;
  const url = URL.createObjectURL(new Blob([c.bytes], { type: c.type }));
  coverUrls.set(id, url);
  return url;
}

function dropCoverUrl(id: string): void {
  const u = coverUrls.get(id);
  if (u) URL.revokeObjectURL(u);
  coverUrls.delete(id);
}

/* ------------------------------------------------------------------ */
/* Dialog helper                                                       */
/* ------------------------------------------------------------------ */

function showDialog(title: string, body: Node[], actions: HTMLElement[]): HTMLDialogElement {
  const d = dialog();
  clear(d);
  const close = h('button', { type: 'button', class: 'btn small', 'aria-label': 'Close' }, 'Close');
  close.addEventListener('click', () => d.close());
  d.append(h('div', { class: 'dlg' },
    h('header', {}, h('h2', { id: 'dialog-title' }, title), close),
    h('div', { class: 'body' }, ...body),
    h('footer', {}, ...actions)));
  if (!d.open) d.showModal();
  return d;
}

function categorySelect(selected: string | null, withNew = true): HTMLSelectElement {
  return h('select', {},
    option('', 'Inbox (no category)', !selected),
    store.categories.map((c) => option(c.id, c.name, c.id === selected)),
    withNew ? option('__new', '+ New category…', false) : null);
}

async function resolveCategory(sel: HTMLSelectElement, newName: HTMLInputElement): Promise<string | null> {
  if (sel.value === '__new') {
    const name = cleanText(newName.value, LIMITS.categoryName).replace(/\s+/g, ' ');
    if (!name) return null;
    const c = await store.addCategory(name);
    reindex();
    return c.id;
  }
  return sel.value || null;
}

function newCategoryInput(sel: HTMLSelectElement): HTMLLabelElement {
  const input = h('input', { type: 'text', dir: 'auto', maxlength: LIMITS.categoryName, placeholder: 'e.g. Sewing or מתכונים' });
  const label = h('label', { class: 'field' }, h('span', {}, 'New category name'), input);
  label.hidden = sel.value !== '__new';
  sel.addEventListener('change', () => {
    label.hidden = sel.value !== '__new';
    if (!label.hidden) input.focus();
  });
  return label;
}

/* ------------------------------------------------------------------ */
/* Add link                                                            */
/* ------------------------------------------------------------------ */

function openAddDialog(prefill = ''): void {
  const url = h('input', { type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'https://…', value: prefill, 'aria-describedby': 'add-err', dir: 'ltr' });
  url.value = prefill;
  const err = h('p', { class: 'error', id: 'add-err', role: 'alert' });
  const title = h('input', { type: 'text', dir: 'auto', maxlength: LIMITS.title, placeholder: 'Optional' });
  const note = h('textarea', { dir: 'auto', maxlength: LIMITS.note, placeholder: 'Optional' });
  const cat = categorySelect(null);
  const newCat = newCategoryInput(cat);
  const suggestionBox = h('p', { class: 'hint', 'aria-live': 'polite' });
  const paste = h('button', { type: 'button', class: 'btn small' }, 'Paste');
  paste.addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      url.value = t.trim();
      url.dispatchEvent(new Event('input'));
    } catch {
      toast('Paste is blocked here — long-press the field and choose Paste.');
      url.focus();
    }
  });
  const updateSuggestion = () => {
    clear(suggestionBox);
    if (cat.value) return;
    const s = suggestCategory({ title: title.value, note: note.value, tags: [], sharedText: '' }, store.categories);
    if (!s) return;
    const use = h('button', { type: 'button', class: 'btn small' }, s.kind === 'existing' ? `Use ${s.name}` : `Create “${s.name}”`);
    use.addEventListener('click', async () => {
      if (s.kind === 'existing') cat.value = s.categoryId;
      else {
        const c = await store.addCategory(s.name);
        reindex();
        cat.append(option(c.id, c.name, true));
        cat.value = c.id;
      }
      clear(suggestionBox);
    });
    suggestionBox.append('Suggestion: ', use);
  };
  title.addEventListener('input', updateSuggestion);
  note.addEventListener('input', updateSuggestion);
  url.addEventListener('input', () => (err.textContent = ''));

  const save = h('button', { type: 'button', class: 'btn primary' }, 'Save');
  save.addEventListener('click', async (e) => {
    e.preventDefault();
    const a = analyzeLink(url.value);
    if (!a.ok) {
      err.textContent = a.reason;
      url.focus();
      return;
    }
    if (store.hasKey(a.info.key)) {
      const existing = store.bookmarks.find((b) => b.key === a.info.key)!;
      err.textContent = 'This link is already in your library.';
      const edit = h('button', { type: 'button', class: 'btn small' }, 'Edit existing');
      edit.addEventListener('click', () => openEditDialog(existing.id));
      err.append(' ', edit);
      return;
    }
    const categoryId = await resolveCategory(cat, newCat.querySelector('input')!);
    const b = newBookmark(a.info, { title: title.value, note: note.value, categoryId, source: 'manual' });
    await store.addBookmarks([b]);
    void requestPersistence();
    dialog().close();
    toast(categoryId ? 'Saved' : 'Saved to Inbox');
    render();
  });
  showDialog('Add Link', [
    h('label', { class: 'field' }, h('span', {}, 'Link'), h('div', { class: 'row' }, url, paste)),
    err,
    h('label', { class: 'field' }, h('span', {}, 'Title'), title),
    h('label', { class: 'field' }, h('span', {}, 'Note'), note),
    h('label', { class: 'field' }, h('span', {}, 'Category'), cat),
    newCat,
    suggestionBox,
    h('p', { class: 'hint' }, 'Only the link is required. Nothing is fetched from the site.'),
  ], [
    h('button', { type: 'button', class: 'btn', onclick: () => { dialog().close(); openBulkDialog(); } }, 'Paste many…'),
    h('span', { class: 'spacer' }),
    save,
  ]);
  url.style.flex = '1';
  url.style.width = 'auto';
  url.focus();
}

/* ------------------------------------------------------------------ */
/* Edit                                                                */
/* ------------------------------------------------------------------ */

function openEditDialog(id: string): void {
  const b = store.get(id);
  if (!b) return;
  const title = h('input', { type: 'text', dir: 'auto', maxlength: LIMITS.title, placeholder: displayTitle(b) });
  title.value = b.title ?? '';
  const note = h('textarea', { dir: 'auto', maxlength: LIMITS.note });
  note.value = b.note ?? '';
  const tags = h('input', { type: 'text', dir: 'auto', placeholder: 'comma, separated' });
  tags.value = b.tags.join(', ');
  const cat = categorySelect(b.categoryId);
  const newCat = newCategoryInput(cat);
  const type = h('select', {}, MEDIA_TYPES.map((t) => option(t, MEDIA_LABELS[t], t === b.mediaType)));

  const coverBox = h('div', { class: 'row' });
  const renderCover = async () => {
    clear(coverBox);
    const cur = store.get(id)!;
    const preview = h('div', { class: 'cover-preview' });
    if (cur.hasCover) {
      const u = await coverObjectUrl(id);
      if (u) preview.append(h('img', { src: u, alt: 'Current cover image' }));
    } else preview.append(placeholder(cur));
    const add = h('button', { type: 'button', class: 'btn small' }, cur.hasCover ? 'Replace cover' : 'Add cover image');
    add.addEventListener('click', async () => {
      const [file] = await pickFiles('image/*', false);
      if (!file) return;
      try {
        add.disabled = true;
        add.textContent = 'Resizing…';
        const c = await makeCover(file);
        await store.putCover({ id, ...c });
        dropCoverUrl(id);
        toast('Cover saved on this device');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not use this image');
      }
      void renderCover();
    });
    const actions = h('div', { class: 'row' }, add);
    actions.style.flexDirection = 'column';
    actions.style.alignItems = 'flex-start';
    if (cur.hasCover) {
      const rm = h('button', { type: 'button', class: 'btn small danger' }, 'Remove cover');
      rm.addEventListener('click', async () => {
        await store.removeCover(id);
        dropCoverUrl(id);
        void renderCover();
      });
      actions.append(rm);
    }
    actions.append(h('p', { class: 'hint' }, 'A screenshot works well. It is resized on this device and only the small copy is kept.'));
    coverBox.append(preview, actions);
  };
  void renderCover();

  const copy = h('button', { type: 'button', class: 'btn small' }, 'Copy link');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.url);
      toast('Link copied');
    } catch {
      toast('Copy is blocked here');
    }
  });
  const del = h('button', { type: 'button', class: 'btn danger' }, 'Delete');
  del.addEventListener('click', async () => {
    if (!window.confirm('Delete this bookmark? This cannot be undone.')) return;
    await store.deleteBookmark(id);
    dropCoverUrl(id);
    index.invalidate(id);
    dialog().close();
    toast('Deleted');
    render();
  });
  const save = h('button', { type: 'button', class: 'btn primary' }, 'Save');
  save.addEventListener('click', async () => {
    const categoryId = await resolveCategory(cat, newCat.querySelector('input')!);
    const mediaType = type.value as MediaType;
    await store.updateBookmark(id, {
      title: cleanText(title.value, LIMITS.title) || undefined,
      note: cleanText(note.value, LIMITS.note) || undefined,
      tags: cleanTags(tags.value, LIMITS.tag, LIMITS.tags),
      categoryId,
      mediaType,
      mediaTypeEdited: b.mediaTypeEdited || mediaType !== b.mediaType,
    });
    index.invalidate(id);
    dialog().close();
    toast('Saved');
    render();
  });

  showDialog('Edit bookmark', [
    h('div', { class: 'field' }, h('span', {}, 'Original link'), h('p', { class: 'url-text', dir: 'ltr' }, b.url),
      h('div', { class: 'row' },
        h('a', { class: 'btn small', href: b.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open original'), copy)),
    b.sharedText ? h('div', { class: 'field' }, h('span', {}, 'Shared text'), h('p', { class: 'shared', dir: 'auto' }, b.sharedText)) : null,
    h('label', { class: 'field' }, h('span', {}, 'Title'), title),
    h('label', { class: 'field' }, h('span', {}, 'Category'), cat),
    newCat,
    h('label', { class: 'field' }, h('span', {}, 'Note'), note),
    h('label', { class: 'field' }, h('span', {}, 'Tags'), tags),
    h('label', { class: 'field' }, h('span', {}, `Type (${PLATFORM_LABELS[b.platform]})`), type),
    h('div', { class: 'field' }, h('span', {}, 'Cover'), coverBox),
    h('p', { class: 'hint' }, `Saved ${new Date(b.savedAt).toLocaleString()} · via ${b.source}`),
  ].filter(Boolean) as Node[], [del, h('span', { class: 'spacer' }), save]);
}

/* ------------------------------------------------------------------ */
/* Import preview (shared by bulk paste, Shortcut inbox)               */
/* ------------------------------------------------------------------ */

function previewDialog(
  title: string,
  plan: ImportPlan,
  extra: Node[],
  onConfirm: () => Promise<void>,
): void {
  const stats = h('div', { class: 'stats' },
    h('div', {}, h('strong', {}, String(plan.toAdd.length)), 'new'),
    h('div', {}, h('strong', {}, String(plan.duplicates)), 'duplicates'),
    h('div', {}, h('strong', {}, String(plan.invalid)), 'invalid'));
  const list = h('ul', { class: 'preview-list' },
    plan.toAdd.slice(0, 100).map((b) => h('li', { dir: 'auto' },
      h('strong', {}, `${PLATFORM_LABELS[b.platform]} ${MEDIA_LABELS[b.mediaType]}`), ' · ',
      b.sharedText ? b.sharedText.slice(0, 120) : displayUrl(b.url))));
  const confirm = h('button', { type: 'button', class: 'btn primary', disabled: plan.toAdd.length === 0 },
    plan.toAdd.length ? `Add ${plan.toAdd.length}` : 'Nothing new to add');
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    await onConfirm();
  });
  showDialog(title, [
    stats,
    ...extra,
    plan.toAdd.length ? h('p', { class: 'hint' }, 'New items go to the Inbox, where you can accept category suggestions.') : null,
    plan.toAdd.length > 100 ? h('p', { class: 'hint' }, `Showing the first 100 of ${plan.toAdd.length}.`) : null,
    list,
  ].filter(Boolean) as Node[], [h('button', { type: 'button', class: 'btn', onclick: () => dialog().close() }, 'Cancel'), confirm]);
}

function openBulkDialog(): void {
  const ta = h('textarea', { dir: 'auto', rows: 10, placeholder: 'Paste links — one per line, or any text containing links.' });
  ta.style.minHeight = '200px';
  const next = h('button', { type: 'button', class: 'btn primary' }, 'Preview');
  next.addEventListener('click', () => {
    const r = parseBulkText(ta.value);
    const plan = planImport(r.candidates, store.keySet(), 'paste', r.invalid);
    previewDialog('Paste links — preview', plan,
      r.truncated ? [h('p', { class: 'error' }, `Only the first ${LIMITS.bulkPasteUrls} links / 500,000 characters are used.`)] : [],
      async () => {
        const added = await store.addBookmarks(plan.toAdd);
        void requestPersistence();
        dialog().close();
        toast(`Added ${added.length}`);
        go('inbox');
      });
  });
  showDialog('Paste links', [ta, h('p', { class: 'hint' }, 'Text on the same line as a link is kept as its shared text. Short links are not expanded.')],
    [h('button', { type: 'button', class: 'btn', onclick: () => dialog().close() }, 'Cancel'), next]);
  ta.focus();
}

async function importShortcutInbox(): Promise<void> {
  const files = await pickFiles('.json,.txt,application/json,text/plain', true);
  if (!files.length) return;
  const problems: FileProblem[] = [];
  const captures: Capture[] = [];
  for (const f of files.slice(0, LIMITS.captureFiles)) {
    if (f.size > LIMITS.captureFileBytes) {
      problems.push({ fileName: f.name, reason: 'Too large for a capture file' });
      continue;
    }
    const r = parseCaptureFile(f.name, await readFileText(f));
    if (isCapture(r)) captures.push(r);
    else problems.push(r);
  }
  if (files.length > LIMITS.captureFiles) {
    problems.push({ fileName: `${files.length - LIMITS.captureFiles} more files`, reason: `Only ${LIMITS.captureFiles} files per import` });
  }
  const already = await store.importedCaptureIds(captures.map((c) => c.id));
  const fresh = captures.filter((c) => !already.has(c.id));
  const invalidUrls = captures.reduce((n, c) => n + c.invalid, 0);
  const plan = planImport(capturesToCandidates(fresh), store.keySet(), 'shortcut', problems.length + invalidUrls);
  // links inside captures that were imported before count as duplicates
  plan.duplicates += capturesToCandidates(captures.filter((c) => already.has(c.id))).length;
  const extra: Node[] = [h('p', { class: 'hint' }, `${files.length} file(s) selected · ${captures.length} capture(s) read` +
    (already.size ? ` · ${already.size} imported before` : ''))];
  if (problems.length) {
    extra.push(h('details', {}, h('summary', {}, `${problems.length} file(s) skipped`),
      h('ul', { class: 'preview-list' }, problems.map((p) => h('li', {}, `${p.fileName}: ${p.reason}`)))));
  }
  previewDialog('Import Shortcut Inbox', plan, extra, async () => {
    const added = await store.addBookmarks(plan.toAdd, { captureIds: fresh.map((c) => c.id) });
    void requestPersistence();
    showDialog('Imported', [
      h('p', {}, `Added ${added.length} bookmark(s) to your Inbox.`),
      h('p', { class: 'hint' }, 'The capture files are still in your Files inbox folder. You can delete them there — importing them again later is safe and adds nothing twice.'),
    ], [h('button', { type: 'button', class: 'btn primary', onclick: () => { dialog().close(); go('inbox'); } }, 'Go to Inbox')]);
  });
}

/* ------------------------------------------------------------------ */
/* Backup / restore                                                    */
/* ------------------------------------------------------------------ */

async function exportBackup(): Promise<void> {
  const covers: NonNullable<BackupFile['covers']> = {};
  for (const c of await store.allCovers()) covers[c.id] = { dataUrl: encodeDataUrl(c.type, c.bytes), width: c.width, height: c.height };
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    categories: store.categories,
    bookmarks: store.bookmarks,
    covers,
  };
  const json = JSON.stringify(backup);
  if (json.length > LIMITS.backupBytes) toast('Warning: this backup is larger than the restore limit (40 MB).', 6000);
  const name = `save-library-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  const a = h('a', { href: URL.createObjectURL(file), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

async function restoreBackup(): Promise<void> {
  const [file] = await pickFiles('.json,application/json', false);
  if (!file) return;
  if (file.size > LIMITS.backupBytes) {
    toast('Backup is larger than the 40 MB limit');
    return;
  }
  const parsed = parseBackup(await readFileText(file));
  if (!parsed.ok) {
    toast(parsed.reason, 5000);
    return;
  }
  const plan = planRestore(parsed.backup, store.keySet(), store.categories);
  previewDialog('Restore backup', { toAdd: plan.toAdd, duplicates: plan.duplicates, invalid: plan.invalid }, [
    h('p', { class: 'hint' }, `Backup v${parsed.backup.version} from ${parsed.backup.exportedAt || 'unknown date'}. ` +
      `${plan.categoriesToAdd.length} new categor${plan.categoriesToAdd.length === 1 ? 'y' : 'ies'}, ${plan.covers.size} cover(s).` +
      (plan.coversSkipped ? ` ${plan.coversSkipped} unsafe cover(s) skipped.` : '') +
      ' Existing bookmarks are kept as they are.'),
  ], async () => {
    const added = await store.addBookmarks(plan.toAdd, { categories: plan.categoriesToAdd, covers: plan.covers });
    reindex();
    void requestPersistence();
    dialog().close();
    toast(`Restored ${added.length} bookmark(s)`);
    go('library');
  });
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

function renderCategories(m: HTMLElement): void {
  const input = h('input', { type: 'text', dir: 'auto', maxlength: LIMITS.categoryName, placeholder: 'New category, e.g. Sewing', 'aria-label': 'New category name' });
  const add = h('button', { type: 'submit', class: 'btn primary' }, 'Add');
  const form = h('form', { class: 'row' }, input, add);
  input.style.flex = '1';
  input.style.width = 'auto';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = cleanText(input.value, LIMITS.categoryName).replace(/\s+/g, ' ');
    if (!name) return;
    if (store.categories.length >= LIMITS.categories) return toast('Too many categories');
    await store.addCategory(name);
    reindex();
    render();
  });
  const counts = new Map<string, number>();
  for (const b of store.bookmarks) if (b.categoryId) counts.set(b.categoryId, (counts.get(b.categoryId) ?? 0) + 1);
  const inboxN = store.bookmarks.filter((b) => !b.categoryId).length;
  const ul = h('ul', { class: 'cat-list' },
    h('li', { class: 'cat-item' },
      h('button', { type: 'button', class: 'name', onclick: () => go('inbox') }, `Inbox (${inboxN})`)),
    store.categories.map((c) => {
      const n = counts.get(c.id) ?? 0;
      const rename = h('button', { type: 'button', class: 'btn small', 'aria-label': `Rename ${c.name}` }, 'Rename');
      rename.addEventListener('click', async () => {
        const name = cleanText(window.prompt('Rename category', c.name) ?? '', LIMITS.categoryName).replace(/\s+/g, ' ');
        if (!name || name === c.name) return;
        await store.renameCategory(c.id, name);
        reindex();
        render();
      });
      const del = h('button', { type: 'button', class: 'btn small danger', 'aria-label': `Delete ${c.name}` }, 'Delete');
      del.addEventListener('click', async () => {
        if (!window.confirm(`Delete “${c.name}”? ${n} bookmark(s) will return to the Inbox.`)) return;
        await store.deleteCategory(c.id);
        reindex();
        render();
      });
      return h('li', { class: 'cat-item' },
        h('button', { type: 'button', class: 'name', dir: 'auto', onclick: () => go('library', { category: c.id }) }, `${c.name} (${n})`),
        rename, del);
    }));
  m.append(form, h('div', {}), ul);
  (m.lastElementChild as HTMLElement).style.marginTop = '12px';
  if (!store.categories.length) m.append(h('p', { class: 'empty' }, 'No categories yet. Try “Sewing” or “Recipes”.'));
}

/* ------------------------------------------------------------------ */
/* More / settings                                                     */
/* ------------------------------------------------------------------ */

function renderMore(m: HTMLElement): void {
  const remote = h('input', { type: 'checkbox', id: 'remote-thumbs', checked: store.settings.remoteThumbnails });
  remote.addEventListener('change', async () => {
    await store.saveSettings({ remoteThumbnails: remote.checked });
    toast(remote.checked ? 'YouTube previews on' : 'Remote previews off');
  });
  const storageInfo = h('p', { 'aria-live': 'polite' }, 'Checking storage…');
  void describeStorage(storageInfo);
  const persist = h('button', { type: 'button', class: 'btn small' }, 'Ask to keep data');
  persist.addEventListener('click', async () => {
    await requestPersistence();
    void describeStorage(storageInfo);
  });

  m.append(
    h('section', { class: 'section' },
      h('h2', {}, 'Add'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => importShortcutInbox() }, 'Import Shortcut Inbox'),
        h('button', { type: 'button', class: 'btn', onclick: () => openAddDialog() }, 'Add Link'),
        h('button', { type: 'button', class: 'btn', onclick: () => openBulkDialog() }, 'Paste many')),
      h('p', {}, 'Import Shortcut Inbox opens Files. Select the capture files in your inbox folder (select several at once); you will see a preview before anything is added.')),
    h('section', { class: 'section' },
      h('h2', {}, 'Previews'),
      h('label', { class: 'switch', for: 'remote-thumbs' }, remote,
        h('span', {}, h('strong', {}, 'Load YouTube thumbnails'), h('br'),
          'When on, your device requests small preview images from YouTube (i.ytimg.com) for YouTube links you scroll past. YouTube receives that image request. No referrer is sent and images are not stored. Instagram, Facebook and TikTok have no supported free preview — add a cover from a screenshot instead.'))),
    h('section', { class: 'section' },
      h('h2', {}, 'Backup'),
      h('p', {}, 'Your library lives only in this browser on this device. Export a backup to Files regularly; deleting the Home Screen app or clearing Safari data erases it.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => exportBackup() }, 'Export backup'),
        h('button', { type: 'button', class: 'btn', onclick: () => restoreBackup() }, 'Restore backup'))),
    h('section', { class: 'section' }, h('h2', {}, 'Storage'), storageInfo, persist),
    h('section', { class: 'section' },
      h('h2', {}, 'Privacy'),
      h('p', {}, 'No account, server, analytics or trackers. Links open at their source. Shared text is shown as plain text. Covers you add are resized and stored only on this device.')),
  );
}

async function describeStorage(el: HTMLElement): Promise<void> {
  const parts = [`${store.bookmarks.length} bookmarks, ${store.categories.length} categories, ${store.bookmarks.filter((b) => b.hasCover).length} covers.`];
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage !== undefined) parts.push(`Using about ${(est.usage / 1024 / 1024).toFixed(1)} MB.`);
    const persisted = await navigator.storage?.persisted?.();
    if (persisted !== undefined) parts.push(persisted ? 'Storage is marked persistent.' : 'Storage may be cleared by the system if space runs low.');
  } catch {
    /* not supported */
  }
  el.textContent = parts.join(' ');
}

async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}

void boot();
