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
      if (e instanceof ApiError && e.status === 404) notFound = isbn;
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

  {#if tab === 'scan'}
    <Scanner onscan={lookup} paused={busy || !!selected || !!notFound} />
    <p class="muted small center">
      {#if lookupIsbn}<span class="row inline"><span class="spinner sm"></span> {t('add.looking', { isbn: lookupIsbn })}</span>
      {:else}{t('add.hold')}{/if}
    </p>
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
