<script lang="ts">
  import { api, labels, type BookBrief, type Book, type ReadStatus, type SearchHit } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Cover from './Cover.svelte';

  // Suche in den eigenen Büchern (gelesen zuerst); mit `catalog` zusätzlich im Katalog (DNB/Open Library) –
  // ein Katalogtreffer wird beim Antippen übernommen. onpick bekommt das gewählte Buch.
  let { onpick, exclude = [], catalog = false }: { onpick: (b: BookBrief) => void; exclude?: number[]; catalog?: boolean } = $props();
  let q = $state('');
  let hits = $state<{ status: ReadStatus; book: BookBrief }[]>([]);
  let remote = $state<SearchHit[] | null>(null);
  let searching = $state(false);
  let busy = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout>, rtimer: ReturnType<typeof setTimeout>;

  $effect(() => {
    const query = q;
    clearTimeout(timer);
    timer = setTimeout(() => api.get<typeof hits>(`/me/books?q=${encodeURIComponent(query)}`).then(r => (hits = r)).catch(toastError), 200);
    if (!catalog) return;
    clearTimeout(rtimer);
    remote = null;
    if (query.trim().length < 3) { searching = false; return; }
    searching = true;
    // Katalog ist langsamer und extern → länger warten, bis fertig getippt ist
    rtimer = setTimeout(() => api.get<SearchHit[]>(`/catalog/search?q=${encodeURIComponent(query.trim())}`)
      .then(r => { if (query === q) remote = r; })
      .catch(toastError)
      .finally(() => { if (query === q) searching = false; }), 600);
  });

  const own = $derived(hits.filter(h => !exclude.includes(h.book.id)));
  const ownIds = $derived(new Set(hits.map(h => h.book.id)));
  const fromCatalog = $derived((remote ?? []).filter(h => !(h.bookId && (ownIds.has(h.bookId) || exclude.includes(h.bookId)))));

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

<input type="search" bind:value={q} placeholder={catalog ? t('picker.searchAllPh') : t('top.searchPh')} />
<div class="hits">
  {#if catalog && own.length}<p class="sect small">{t('picker.mine')}</p>{/if}
  {#each own as h (h.book.id)}
    <button class="hit ghost" onclick={() => onpick(h.book)}>
      <Cover url={h.book.coverUrl} title={h.book.title} authors={h.book.authors} size="sm" />
      <span class="grow"><strong>{h.book.title}</strong><span class="muted small">{h.book.authors.join(', ')} · {labels.read[h.status]}</span></span>
    </button>
  {:else}
    {#if !catalog || q.trim().length < 3}<p class="muted small">{catalog ? t('picker.typeMore') : t('add.noHits')}</p>{/if}
  {/each}
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
  .hits { display: grid; gap: 0.3rem; max-height: 50dvh; overflow: auto; margin-top: 0.6rem; }
  .hit { display: flex; gap: 0.7rem; align-items: center; text-align: left; padding: 0.4rem; justify-content: flex-start; height: auto; }
  .hit :global(.cover) { width: 40px; flex: none; }
  .grow { display: grid; min-width: 0; }
  .grow strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sect { margin: 0.5rem 0 0.1rem; color: var(--accent); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.72rem; }
  .spinner.small { width: 22px; height: 22px; margin: 0.5rem auto; }
</style>
