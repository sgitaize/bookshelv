<script lang="ts">
  import { api, catalogSearch, labels, type BookBrief, type Book, type ReadStatus, type SearchHit } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Cover from './Cover.svelte';
  import Icon from './Icon.svelte';

  // Suche in den eigenen Büchern (gelesen zuerst); mit `catalog` zusätzlich im Katalog (DNB/Open Library) –
  // ein Katalogtreffer wird beim Antippen übernommen. onpick bekommt das gewählte Buch.
  // Mit `selected` (Leselisten) bleiben gewählte Bücher mit Haken stehen; erneutes Antippen ruft onunpick.
  let { onpick, onunpick, exclude = [], selected, catalog = false }: {
    onpick: (b: BookBrief) => void; onunpick?: (b: BookBrief) => void; exclude?: number[]; selected?: number[]; catalog?: boolean;
  } = $props();
  type Hit = { status: ReadStatus; owned?: boolean; wish?: boolean; book: BookBrief };
  const PAGE = 100;
  let q = $state('');
  let hits = $state<Hit[]>([]);
  let more = $state(false);
  // Reiter: alle eigenen Bücher oder nur die Wunschliste (Wunschbücher gehen sonst unter den gelesenen unter)
  let tab = $state<'mine' | 'wish'>('mine');
  // Filter innerhalb „Meine Bücher“, z. B. nur ungelesene
  const FILTERS = ['all', 'unread', 'reading', 'read', 'owned'] as const;
  let filter = $state<(typeof FILTERS)[number]>('all');
  const filterLabel = (f: (typeof FILTERS)[number]) => f === 'all' ? t('filter.all') : f === 'owned' ? t('picker.owned') : labels.read[f];
  const url = (query: string, offset = 0) =>
    `/me/books?q=${encodeURIComponent(query)}${tab === 'wish' ? '&wish=1' : filter !== 'all' ? `&filter=${filter}` : ''}${offset ? `&offset=${offset}` : ''}`;
  async function loadMore() {
    const r = await api.get<Hit[]>(url(q, hits.length)).catch(e => (toastError(e), []));
    hits = [...hits, ...r];
    more = r.length === PAGE;
  }
  let remote = $state<SearchHit[] | null>(null);
  let searching = $state(false);
  let busy = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout>, rtimer: ReturnType<typeof setTimeout>;

  $effect(() => {
    const query = q;
    const u = url(query);
    clearTimeout(timer);
    timer = setTimeout(() => api.get<Hit[]>(u).then(r => { hits = r; more = r.length === PAGE; }).catch(toastError), 200);
    if (!catalog) return;
    clearTimeout(rtimer);
    remote = null;
    if (query.trim().length < 3) { searching = false; return; }
    searching = true;
    // Katalog ist langsamer und extern → länger warten, bis fertig getippt ist
    rtimer = setTimeout(() => catalogSearch(query.trim(), r => { if (query === q) remote = r; })
      .catch(toastError)
      .finally(() => { if (query === q) searching = false; }), 600);
  });

  const own = $derived(hits.filter(h => !exclude.includes(h.book.id)));
  const isSel = (id: number) => !!selected?.includes(id);
  const tap = (b: BookBrief) => (isSel(b.id) && onunpick ? onunpick(b) : onpick(b));
  const ownIds = $derived(new Set(hits.map(h => h.book.id)));
  const fromCatalog = $derived((remote ?? []).filter(h => !(h.bookId && (ownIds.has(h.bookId) || exclude.includes(h.bookId) || isSel(h.bookId)))));

  async function pickRemote(h: SearchHit) {
    if (h.bookId) return onpick({ id: h.bookId, title: h.title, subtitle: h.subtitle, authors: h.authors, year: h.year, pages: null, coverUrl: h.coverUrl });
    if (!h.isbn13) return;
    busy = h.isbn13;
    try {
      const r = await api.post<{ book: Book }>('/catalog/isbn', { isbn: h.isbn13 });
      onpick({ id: r.book.id, title: r.book.title, subtitle: r.book.subtitle, authors: r.book.authors, year: r.book.year, pages: r.book.pages, coverUrl: r.book.coverUrl });
    } catch (e) { toastError(e); } finally { busy = null; }
  }
</script>

<div class="segmented tabs">
  <button class:active={tab === 'mine'} onclick={() => (tab = 'mine')}>{t('picker.tabMine')}</button>
  <button class:active={tab === 'wish'} onclick={() => (tab = 'wish')}>{t('picker.tabWish')}</button>
</div>
{#if tab === 'mine'}
  <div class="chips" role="group" aria-label={t('picker.filter')}>
    {#each FILTERS as f}<button class:active={filter === f} aria-pressed={filter === f} onclick={() => (filter = f)}>{filterLabel(f)}</button>{/each}
  </div>
{/if}
<input type="search" bind:value={q} placeholder={catalog ? t('picker.searchAllPh') : t('top.searchPh')} />
<div class="hits">
  {#if catalog && own.length}<p class="sect small">{t('picker.mine')}</p>{/if}
  {#each own as h (h.book.id)}
    {@const on = isSel(h.book.id)}
    <button class="hit ghost" class:on aria-pressed={selected ? on : undefined} onclick={() => tap(h.book)}>
      {#if selected}<span class="box">{#if on}<Icon name="check" size={16} />{/if}</span>{/if}
      <Cover url={h.book.coverUrl} title={h.book.title} authors={h.book.authors} size="sm" />
      <span class="grow"><strong>{h.book.title}</strong><span class="muted small">{h.book.authors.join(', ')} · {h.wish && !h.owned ? t('picker.wish') : labels.read[h.status]}{#if !h.owned && !h.wish} · {t('picker.notOwned')}{/if}</span></span>
    </button>
  {:else}
    {#if !catalog || q.trim().length < 3}<p class="muted small">{catalog ? t('picker.typeMore') : t('add.noHits')}</p>{/if}
  {/each}
  {#if more}<button class="small moreb" onclick={loadMore}>{t('feed.more')}</button>{/if}
  {#if catalog && q.trim().length >= 3}
    <p class="sect small">{t('picker.catalog')}</p>
    {#if searching}
      <div class="spinner small"></div>
    {:else}
      {#each fromCatalog as h (h.isbn13 ?? h.title)}
        <button class="hit ghost" disabled={!h.bookId && !h.isbn13 || busy !== null} onclick={() => pickRemote(h)}>
          <Cover url={h.coverUrl} title={h.title} authors={h.authors} size="sm" />
          <span class="grow"><strong>{h.title}</strong><span class="muted small">{[h.authors.join(', '), h.year].filter(Boolean).join(' · ')}{#if busy === h.isbn13}{' · '}{t('picker.adding')}{/if}</span></span>
        </button>
      {:else}
        <p class="muted small">{t('add.noHits')}</p>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .tabs { margin-bottom: 0.6rem; }
  /* kein eigener Scrollbereich: das Sheet scrollt (verschachteltes Scrollen hing auf iOS und erreichte das Listenende nicht) */
  .hits { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.3rem; margin-top: 0.6rem; }
  /* wie die Filter der Bibliothek */
  .chips { display: flex; gap: 0.4rem; overflow-x: auto; scrollbar-width: none; margin-bottom: 0.6rem; }
  .chips button { font-size: 0.85rem; padding: 0.4em 0.9em; flex-shrink: 0; border-radius: 999px; }
  .chips button.active { background: var(--accent); color: var(--accent-ink); }
  .hit.on { background: var(--accent-soft); }
  .box { width: 22px; height: 22px; flex: none; border-radius: 6px; border: 2px solid var(--line); display: grid; place-items: center; }
  .on .box { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .moreb { justify-self: center; margin-top: 0.4rem; }
  .hit { display: flex; gap: 0.7rem; align-items: center; text-align: left; padding: 0.4rem; justify-content: flex-start; height: auto; min-width: 0; }
  .hit :global(.cover) { width: 40px; flex: none; }
  .grow { flex: 1; display: grid; min-width: 0; }
  .grow strong, .grow .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sect { margin: 0.5rem 0 0.1rem; color: var(--accent); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.72rem; }
  .spinner.small { width: 22px; height: 22px; margin: 0.5rem auto; }
</style>
