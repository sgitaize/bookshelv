<script lang="ts">
  import { api, ApiError, emptyCopy, type Book, type Copy, type CopyValues, type SearchHit } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, tn, i18n, fmtDate } from '../lib/i18n.svelte.ts';
  import Scanner from '../components/Scanner.svelte';
  import Cover from '../components/Cover.svelte';
  import CopyForm from '../components/CopyForm.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Icon from '../components/Icon.svelte';
  import PendingScans from '../components/PendingScans.svelte';
  import { net, isNetworkError, queueScan, pending, type ScanTarget } from '../lib/offline.svelte.ts';

  type Tab = 'scan' | 'search' | 'manual';
  let tab = $state<Tab>((router.query.get('tab') as Tab) ?? 'scan');

  // ausgewähltes Buch, das ins Regal soll
  let selected = $state<{ book: Book; owned: number } | null>(null);
  // Einstellungen vom letzten Buch übernehmen – praktisch beim Durchscannen eines ganzen Regals
  let copy = $state<CopyValues>(emptyCopy());
  let busy = $state(false);
  let lookupIsbn = $state<string | null>(null);
  let notFound = $state<string | null>(null);
  let added = $state<Book[]>([]);
  // Scan-Ziel: Regal (mit Dialog) oder direkt auf die Wunschliste (schnell durchscannen, z. B. am Bauchladen)
  // mass = ganzes Regal durchscannen: jeder Scan kommt ohne Dialog mit den gewählten Einstellungen ins Regal
  type Mode = 'shelf' | 'mass' | 'wishlist';
  let target = $state<Mode>((['shelf', 'mass', 'wishlist'] as const).find(m => m === router.query.get('to')) ?? 'shelf');
  let lastQueued = $state<string | null>(null);
  // im Massen-Scan hinzugefügt (mit Exemplar-ID zum sofortigen Entfernen)
  let massAdded = $state<{ book: Book; copyId: number }[]>([]);

  /** ohne Netz: ISBN merken, später fertigstellen */
  function queue(isbn: string) {
    const fresh = queueScan(isbn, target === 'wishlist' ? 'wishlist' : 'shelf', target === 'wishlist' ? undefined : { format: copy.format, binding: copy.binding });
    lastQueued = isbn;
    toast(fresh ? t('offline.saved', { isbn }) : t('offline.already', { isbn }));
  }

  async function onScan(isbn: string) {
    if (!net.online) return queue(isbn);
    if (target === 'wishlist') return quickWish(isbn);
    if (target === 'mass') return quickShelf(isbn);
    return lookup(isbn);
  }

  async function quickShelf(isbn: string) {
    if (busy) return;
    busy = true;
    lookupIsbn = isbn;
    try {
      const r = await api.post<{ book: Book }>('/catalog/isbn', { isbn });
      const detail = await api.get<{ copies: Copy[] }>(`/books/${r.book.id}`);
      if (detail.copies.some(c => c.mine && c.format === copy.format)) { toast(t('scan.alreadyOwned', { title: r.book.title })); return; }
      const c = await api.post<{ id: number }>('/copies', { bookId: r.book.id, format: copy.format, binding: copy.format === 'print' ? copy.binding : null, sprayedEdges: false, notes: '', storeId: null });
      massAdded = [{ book: r.book, copyId: c.id }, ...massAdded];
      toast(t('add.added', { title: r.book.title }));
    } catch (e) {
      if (isNetworkError(e)) { net.online = false; queue(isbn); }
      else if (e instanceof ApiError && e.status === 404) notFound = isbn;
      else toastError(e);
    } finally {
      busy = false;
      lookupIsbn = null;
    }
  }

  /** Fehlscan im Massen-Scan zurücknehmen (Exemplar endgültig löschen) */
  async function unmass(copyId: number) {
    try {
      await api.del(`/copies/${copyId}`, { mode: 'purge' });
      massAdded = massAdded.filter(m => m.copyId !== copyId);
    } catch (e) { toastError(e); }
  }

  /** Wunschliste-Modus: nachschlagen und sofort eintragen, ohne Dialog */
  async function quickWish(isbn: string) {
    if (busy) return;
    busy = true;
    lookupIsbn = isbn;
    try {
      const r = await api.post<{ book: Book }>('/catalog/isbn', { isbn });
      await api.put(`/books/${r.book.id}/wishlist`, {});
      added = [r.book, ...added];
      toast(t('wish.addedTitle', { title: r.book.title }));
    } catch (e) {
      if (isNetworkError(e)) { net.online = false; queue(isbn); }
      else if (e instanceof ApiError && e.status === 404) notFound = isbn;
      else toastError(e);
    } finally {
      busy = false;
      lookupIsbn = null;
    }
  }

  async function select(book: Book) {
    const detail = await api.get<{ copies: Copy[] }>(`/books/${book.id}`);
    copy = { ...copy, notes: '', readStatus: 'unread' };
    selected = { book, owned: detail.copies.filter(c => c.mine).length };
  }

  async function lookup(isbn: string) {
    if (busy) return;
    busy = true;
    lookupIsbn = isbn;
    notFound = null;
    try {
      const r = await api.post<{ book: Book }>('/catalog/isbn', { isbn });
      await select(r.book);
    } catch (e) {
      if (isNetworkError(e)) { net.online = false; queue(isbn); }
      else if (e instanceof ApiError && e.status === 404) notFound = isbn;
      else toastError(e);
    } finally {
      busy = false;
      lookupIsbn = null;
    }
  }

  async function addToShelf() {
    if (!selected) return;
    busy = true;
    try {
      await api.post('/copies', { bookId: selected.book.id, ...copy });
      added = [selected.book, ...added];
      toast(t('add.added', { title: selected.book.title }));
      selected = null;
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }

  async function toWishlist() {
    if (!selected) return;
    try {
      await api.put(`/books/${selected.book.id}/wishlist`, {});
      toast(t('wish.added'));
      selected = null;
    } catch (e) { toastError(e); }
  }

  // ---------- Suche ----------
  let q = $state(router.query.get('q') ?? '');
  let hits = $state<SearchHit[] | null>(null);
  let searching = $state(false);
  let timer: ReturnType<typeof setTimeout>;

  $effect(() => {
    const term = q.trim();
    clearTimeout(timer);
    if (tab !== 'search') return;
    if (term.replace(/[-\s]/g, '').match(/^(97[89])?\d{9}[\dXx]$/)) return; // ISBN → per Enter nachschlagen
    if (term.length < 3) { hits = null; return; }
    timer = setTimeout(async () => {
      searching = true;
      try { hits = await api.get<SearchHit[]>(`/catalog/search?q=${encodeURIComponent(term)}`); }
      catch (e) { toastError(e); }
      finally { searching = false; }
    }, 450);
  });

  function searchSubmit(e: SubmitEvent) {
    e.preventDefault();
    const digits = q.replace(/[-\s]/g, '');
    if (/^(97[89])?\d{9}[\dXx]$/.test(digits)) lookup(digits);
  }

  async function pickHit(h: SearchHit) {
    if (h.bookId) {
      busy = true;
      try { await select((await api.get<{ book: Book }>(`/books/${h.bookId}`)).book); }
      catch (e) { toastError(e); }
      finally { busy = false; }
    } else await lookup(h.isbn13);
  }

  // ---------- Manuell ----------
  let manual = $state({ title: '', subtitle: '', authors: '', isbn: '', publisher: '', year: '', pages: '' });

  function startManual(isbn = '') {
    manual = { title: '', subtitle: '', authors: '', isbn, publisher: '', year: '', pages: '' };
    notFound = null;
    tab = 'manual';
  }
  // Link aus den Offline-Scans: ISBN nicht gefunden → manuell erfassen
  if (router.query.get('tab') === 'manual' && router.query.get('isbn')) startManual(router.query.get('isbn')!);

  async function submitManual(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const book = await api.post<Book>('/books', {
        title: manual.title,
        subtitle: manual.subtitle || null,
        authors: manual.authors.split(/[,;]/).map(a => a.trim()).filter(Boolean),
        isbn: manual.isbn || null,
        publisher: manual.publisher || null,
        year: manual.year || null,
        pages: manual.pages || null
      });
      await select(book);
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }
</script>

<section class="stack">
  <div class="spread">
    <h1>{t('add.title')}</h1>
  </div>

  <div class="segmented tabs">
    <button class:active={tab === 'scan'} onclick={() => (tab = 'scan')}><Icon name="scan" size={16} /> {t('add.scan')}</button>
    <button class:active={tab === 'search'} onclick={() => (tab = 'search')}><Icon name="search" size={16} /> {t('add.search')}</button>
    <button class:active={tab === 'manual'} onclick={() => startManual()}><Icon name="keyboard" size={16} /> {t('add.manual')}</button>
  </div>

  {#if !net.online}<p class="card offline">{t('offline.scanInfo')}</p>{/if}
  {#if net.online && pending.items.length}<PendingScans />{/if}

  {#if tab === 'scan'}
    <div class="target">
      <span class="muted small">{t('scan.target')}</span>
      <div class="segmented">
        <button class:active={target === 'shelf'} onclick={() => (target = 'shelf')}><Icon name="library" size={16} /> {t('scan.toShelf')}</button>
        <button class:active={target === 'mass'} onclick={() => (target = 'mass')}><Icon name="shelf" size={16} /> {t('scan.mass')}</button>
        <button class:active={target === 'wishlist'} onclick={() => (target = 'wishlist')}><Icon name="bookmark" size={16} /> {t('scan.toWishlist')}</button>
      </div>
      {#if target === 'mass'}
        <p class="muted small massinfo">{t('scan.massInfo')}</p>
        <div class="row massopts">
          <div class="segmented">
            <button class:active={copy.format === 'print'} onclick={() => (copy.format = 'print')}>{t('format.print')}</button>
            <button class:active={copy.format === 'ebook'} onclick={() => { copy.format = 'ebook'; copy.binding = null; }}>{t('format.ebook')}</button>
          </div>
          {#if copy.format === 'print'}
            <div class="segmented">
              <button class:active={!copy.binding} onclick={() => (copy.binding = null)}>{t('scan.bindingAny')}</button>
              <button class:active={copy.binding === 'paperback'} onclick={() => (copy.binding = 'paperback')}>{t('binding.paperback')}</button>
              <button class:active={copy.binding === 'hardcover'} onclick={() => (copy.binding = 'hardcover')}>{t('binding.hardcover')}</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
    <Scanner onscan={onScan} paused={busy || !!selected || !!notFound} />
    <p class="muted small center">
      {#if lookupIsbn}<span class="row inline"><span class="spinner sm"></span> {t('add.looking', { isbn: lookupIsbn })}</span>
      {:else if !net.online && lastQueued}{t('offline.lastSaved', { isbn: lastQueued, n: pending.items.length })}
      {:else}{t('add.hold')}{/if}
    </p>
    {#if target === 'mass' && massAdded.length}
      <div class="card stack masslist">
        <h3>{t('scan.massCount', { n: massAdded.length })}</h3>
        {#each massAdded as m (m.copyId)}
          <div class="row massrow">
            <a href="/book/{m.book.id}" class="mcov"><Cover url={m.book.coverUrl} title={m.book.title} authors={m.book.authors} size="sm" /></a>
            <span class="grow"><strong>{m.book.title}</strong><span class="muted small">{m.book.authors.join(', ')}</span></span>
            <button class="icon ghost" onclick={() => unmass(m.copyId)} aria-label={t('scan.undoOne')}><Icon name="x" size={18} /></button>
          </div>
        {/each}
      </div>
    {/if}
  {:else if tab === 'search'}
    <form class="searchbox" onsubmit={searchSubmit}>
      <Icon name="search" size={18} />
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={q} type="search" placeholder={t('add.searchPh')} autofocus />
      {#if searching}<span class="spinner sm"></span>{/if}
    </form>
    {#if hits?.length === 0}
      <div class="empty"><p>{t('add.noHits')}</p><button onclick={() => startManual()}>{t('add.enterManually')}</button></div>
    {:else if hits}
      <ul class="hits">
        {#each hits as h (h.isbn13)}
          <li>
            <button class="hit" onclick={() => pickHit(h)} disabled={busy}>
              <Cover url={h.coverUrl} title={h.title} authors={h.authors} size="sm" />
              <span class="info">
                <strong>{h.title}</strong>
                {#if h.subtitle}<span class="sub">{h.subtitle}</span>{/if}
                <span class="muted small">{h.authors.join(', ')}</span>
                <span class="muted small">{[h.publisher, h.year, h.isbn13].filter(Boolean).join(' · ')}</span>
              </span>
              {#if lookupIsbn === h.isbn13}<span class="spinner sm"></span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted small center">{t('add.sources')}</p>
    {/if}
  {:else}
    <form class="card stack" onsubmit={submitManual}>
      <label class="field"><span>{t('book.title')} *</span><input bind:value={manual.title} required maxlength="300" /></label>
      <label class="field"><span>{t('book.subtitle')}</span><input bind:value={manual.subtitle} maxlength="300" /></label>
      <label class="field"><span>{t('add.authorsComma')}</span><input bind:value={manual.authors} /></label>
      <div class="cols">
        <label class="field"><span>ISBN</span><input bind:value={manual.isbn} inputmode="numeric" /></label>
        <label class="field"><span>{t('book.publisher')}</span><input bind:value={manual.publisher} /></label>
        <label class="field"><span>{t('book.year')}</span><input bind:value={manual.year} inputmode="numeric" maxlength="4" /></label>
        <label class="field"><span>{t('book.pages')}</span><input bind:value={manual.pages} inputmode="numeric" /></label>
      </div>
      <button class="primary" disabled={busy}>{t('common.next')}</button>
    </form>
  {/if}

  {#if added.length}
    <div>
      <h3>{t('add.justAdded')}</h3>
      <div class="added">
        {#each added as b, i (i)}
          <a href="/book/{b.id}"><Cover url={b.coverUrl} title={b.title} authors={b.authors} size="sm" /></a>
        {/each}
      </div>
    </div>
  {/if}
</section>

<Sheet open={!!notFound} onclose={() => (notFound = null)} title={t('add.notFound')}>
  <p class="muted">{t('add.notFoundText', { isbn: notFound ?? '' })}</p>
  <div class="row">
    <button class="primary" onclick={() => startManual(notFound ?? '')}>{t('add.enterManually')}</button>
    <button onclick={() => (notFound = null)}>{t('add.keepScanning')}</button>
  </div>
</Sheet>

<Sheet open={!!selected} onclose={() => (selected = null)} title={t('add.putOnShelf')}>
  {#if selected}
    <div class="picked">
      <Cover url={selected.book.coverUrl} title={selected.book.title} authors={selected.book.authors} />
      <div>
        <h3>{selected.book.title}</h3>
        {#if selected.book.subtitle}<p class="sub">{selected.book.subtitle}</p>{/if}
        <p class="muted small">{selected.book.authors.join(', ')}</p>
        <p class="muted small">{[selected.book.publisher, selected.book.year, selected.book.pages && t('book.pagesShort', { n: selected.book.pages })].filter(Boolean).join(' · ')}</p>
        {#if selected.owned}<p class="chip accent">{t('add.owned', { n: selected.owned })}</p>{/if}
      </div>
    </div>
    <CopyForm bind:value={copy} />
    <div class="row actions">
      <button class="primary" onclick={addToShelf} disabled={busy}><Icon name="check" size={18} /> {t('add.toShelf')}</button>
      <button onclick={toWishlist} disabled={busy}><Icon name="bookmark" size={16} /> {t('wish.add')}</button>
    </div>
  {/if}
</Sheet>

<style>
  .tabs { align-self: start; }
  .target { display: grid; gap: 0.3rem; justify-items: start; max-width: 100%; }
  .target .segmented { flex-wrap: wrap; max-width: 100%; }
  .massinfo { margin: 0.2rem 0 0; }
  .massopts { flex-wrap: wrap; }
  .masslist { padding: 0.8rem 1rem; }
  .massrow { flex-wrap: nowrap; gap: 0.7rem; }
  .mcov { width: 40px; flex: none; }
  .massrow .grow { flex: 1; min-width: 0; display: grid; }
  .massrow strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .offline { padding: 0.8rem 1rem; border-color: color-mix(in srgb, var(--star) 60%, transparent); margin: 0; }
  .tabs button { display: inline-flex; gap: 0.4em; }
  .center { text-align: center; }
  .inline { display: inline-flex; }
  .spinner.sm { width: 16px; height: 16px; border-width: 2px; }
  .searchbox { position: relative; display: flex; align-items: center; }
  .searchbox :global(svg) { position: absolute; left: 0.85rem; color: var(--muted); }
  .searchbox input { padding-left: 2.5rem; font-size: 1.05rem; }
  .searchbox .spinner { position: absolute; right: 0.9rem; }
  .hits { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
  .hit {
    width: 100%; display: flex; align-items: center; gap: 0.9rem; text-align: left;
    padding: 0.6rem; border-radius: 12px; background: var(--surface); white-space: normal; font-weight: 400;
  }
  .info { display: grid; gap: 0.1rem; flex: 1; min-width: 0; }
  .sub { color: var(--muted); font-size: 0.88rem; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; }
  .picked { display: grid; grid-template-columns: 96px 1fr; gap: 1rem; margin-bottom: 1.2rem; align-items: start; }
  .picked h3 { margin-bottom: 0.2rem; }
  .picked p { margin: 0 0 0.2rem; }
  .actions { margin-top: 1.2rem; }
  .actions .primary { flex: 1; }
  .added { display: flex; gap: 0.6rem; overflow-x: auto; padding: 0.3rem 0; }
</style>
