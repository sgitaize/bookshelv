<script lang="ts">
  import { api, labels, type ShelfItem } from '../lib/api.ts';
  import { session, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, tn, i18n, fmtDate, type Key } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';

  // ohne userId: eigenes Regal; mit userId: Regal eines Freundes (nur lesen)
  let { userId }: { userId?: number } = $props();

  let items = $state<ShelfItem[] | null>(null);
  let ownerName = $state('');
  let q = $state('');
  type Filter = 'all' | 'print' | 'ebook' | 'unread' | 'reading' | 'read' | 'lent' | 'edges' | 'favorite' | 'archive' | 'sold';
  let archived = $state<ShelfItem[] | null>(null);
  let filter = $state<Filter>((router.query.get('filter') as Filter) ?? 'all');
  let sort = $state<'added' | 'title' | 'author'>('added');

  const own = $derived(!userId || userId === session.me?.id);

  $effect(() => {
    items = null;
    const req = own
      ? api.get<ShelfItem[]>('/copies').then(r => { items = r; ownerName = ''; })
      : api.get<{ owner: { displayName: string }; copies: ShelfItem[] }>(`/users/${userId}/shelf`).then(r => {
          items = r.copies;
          ownerName = r.owner.displayName;
        });
    req.catch(toastError);
  });

  const filters = $derived([
    ['all', t('filter.all')], ['print', t('filter.print')], ['ebook', t('filter.ebook')], ['unread', t('read.unread')], ['reading', t('read.reading')],
    ['read', t('read.read')], ['favorite', t('filter.favorites')], ...(own ? [['lent', t('filter.lent')]] : []), ['edges', t('copy.edges')],
    ...(own ? [['archive', t('filter.archive')], ['sold', t('filter.sold')]] : [])
  ] as [Filter, string][]);

  // Archiv wird erst geladen, wenn der Filter gewählt wird
  $effect(() => {
    if ((filter === 'archive' || filter === 'sold') && own && archived === null)
      api.get<ShelfItem[]>('/copies?archived=1').then(r => (archived = r)).catch(toastError);
  });

  const bookCount = $derived(new Set((items ?? []).map(i => i.book.id)).size);

  const shown = $derived.by(() => {
    if (filter === 'archive' || filter === 'sold') {
      const needle = q.trim().toLowerCase();
      return (archived ?? []).filter(it => (filter === 'archive' || it.removedReason === 'sold')
        && (!needle || `${it.book.title} ${it.book.authors.join(' ')}`.toLowerCase().includes(needle)))
        .map(it => ({ ...it, formats: new Set<string>([it.format]) }));
    }
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    const list = items.filter(it => {
      if (needle && !`${it.book.title} ${it.book.subtitle ?? ''} ${it.book.authors.join(' ')}`.toLowerCase().includes(needle)) return false;
      switch (filter) {
        case 'print': case 'ebook': return it.format === filter;
        case 'unread': case 'reading': case 'read': return it.readStatus === filter;
        case 'lent': return it.lent;
        case 'edges': return it.sprayedEdges;
        case 'favorite': return it.favorite;
        default: return true;
      }
    });
    const key = (it: ShelfItem) => sort === 'title' ? it.book.title : (it.book.authors[0]?.split(' ').pop() ?? '');
    const sorted = sort === 'added' ? list : [...list].sort((a, b) => key(a).localeCompare(key(b), i18n.lang));
    // gleiche Titel (z. B. gedruckt + E-Book) zu einer Kachel zusammenführen
    const byBook = new Map<number, ShelfItem & { formats: Set<string> }>();
    for (const it of sorted) {
      const g = byBook.get(it.book.id);
      if (!g) byBook.set(it.book.id, { ...it, formats: new Set([it.format]) });
      else { g.formats.add(it.format); g.lent ||= it.lent; g.sprayedEdges ||= it.sprayedEdges; }
    }
    return [...byBook.values()];
  });
</script>

<section>
  <div class="spread head">
    <div>
      <h1>{own ? t('shelf.mine') : t('shelf.of', { name: ownerName })}</h1>
      <div class="meta">
        {#if items}<p class="muted">{tn('n.books', bookCount)}{#if shown.length !== bookCount} · {t('shelf.shown', { n: shown.length })}{/if}</p>{/if}
        {#if own}<a href="/history" class="histlink small">{t('hist.title')} →</a>{/if}
      </div>
    </div>
  </div>

  {#if items && (items.length || own)}
    <div class="tools">
      <div class="searchbox">
        <Icon name="search" size={18} />
        <input bind:value={q} placeholder={t('shelf.filter')} type="search" />
      </div>
      <select bind:value={sort} aria-label={t('shelf.sort')}>
        <option value="added">{t('shelf.newest')}</option>
        <option value="title">{t('book.title')}</option>
        <option value="author">{t('shelf.author')}</option>
      </select>
    </div>
    <div class="chips">
      {#each filters as [key, label]}
        <button class:active={filter === key} onclick={() => (filter = key)}>{label}</button>
      {/each}
    </div>
  {/if}

  {#if items === null}
    <div class="grid">{#each Array(8) as _}<div class="skeleton"></div>{/each}</div>
  {:else if items.length === 0 && filter !== 'archive' && filter !== 'sold'}
    <div class="empty">
      <h2>{own ? t('shelf.empty') : t('shelf.noBooks')}</h2>
      {#if own}
        <p>{t('shelf.emptyText')}</p>
        <a href="/add" class="btn primary"><Icon name="scan" size={18} /> {t('shelf.addFirst')}</a>
        <p><a href="/import">{t('imp.link')}</a></p>
      {/if}
    </div>
  {:else}
    <div class="grid">
      {#each shown as it (it.id)}
        <a class="item" href="/book/{it.book.id}">
          <div class="cv" class:gone={!!it.removedAt}>
            <Cover url={it.book.coverUrl} title={it.book.title} authors={it.book.authors} />
            <div class="badges">
              {#if it.lent}<span class="chip accent">{t('shelf.lent')}</span>{/if}
              {#if it.removedAt}<span class="chip accent">{t(`rm.${it.removedReason ?? 'other'}` as Key)}</span>{/if}
              {#if it.formats.has('ebook')}<span class="chip">{it.formats.has('print') ? t('shelf.plusEbook') : t('format.ebook')}</span>{/if}
              {#if it.sprayedEdges}<span class="chip edge">{t('copy.edges')}</span>{/if}
            </div>
            {#if it.readStatus !== 'unread'}<span class="status {it.readStatus}" title={labels.read[it.readStatus]}></span>{/if}
          </div>
          <div class="t">{it.book.title}</div>
          <div class="a muted">{it.book.authors.join(', ')}</div>
        </a>
      {/each}
    </div>
    {#if !shown.length}<p class="empty">{t('shelf.nothing')}</p>{/if}
  {/if}
</section>

<style>
  .head { margin-bottom: 1rem; align-items: flex-end; }
  .head p { margin: 0; }
  .meta { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.25rem 1rem; }
  .meta p { margin: 0; }
  .histlink { white-space: nowrap; }
  .tools { display: flex; gap: 0.6rem; margin-bottom: 0.7rem; }
  .tools select { width: auto; }
  .searchbox { position: relative; flex: 1; display: flex; align-items: center; }
  .searchbox :global(svg) { position: absolute; left: 0.8rem; color: var(--muted); pointer-events: none; }
  .searchbox input { padding-left: 2.4rem; }
  .chips { display: flex; gap: 0.4rem; overflow-x: auto; padding-bottom: 0.4rem; margin-bottom: 1rem; scrollbar-width: none; }
  .chips button { font-size: 0.85rem; padding: 0.4em 0.9em; flex-shrink: 0; }
  .chips button { border-radius: 999px; }
  .chips button.active { background: var(--accent); color: var(--accent-ink); }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 1.3rem 0.85rem;
  }
  @media (min-width: 760px) { .grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 2rem 1.5rem; } }
  .item { color: var(--text); display: block; }
  .item:hover { text-decoration: none; }
  .cv { position: relative; transition: transform 0.25s cubic-bezier(.2,.8,.3,1.2); }
  .item:hover .cv { transform: translateY(-4px); }
  .gone :global(img) { filter: grayscale(0.85); opacity: 0.7; }
  .badges { position: absolute; left: 8px; right: 6px; bottom: 6px; display: flex; flex-wrap: wrap; gap: 3px; z-index: 1; }
  .badges .chip { box-shadow: 0 1px 4px rgb(0 0 0 / 0.4); }
  .badges .chip:not(.edge):not(.accent) { background: rgb(20 15 10 / 0.8); color: #eee; }
  .badges .chip.accent { background: var(--accent); color: var(--accent-ink); }
  .status { position: absolute; top: 7px; right: 7px; width: 11px; height: 11px; border-radius: 50%; border: 2px solid rgb(0 0 0 / 0.5); z-index: 1; }
  .status.read { background: var(--ok); }
  .status.reading { background: var(--accent); }
  .t { font-weight: 600; font-size: 0.86rem; margin-top: 0.6rem; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .a { font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .skeleton { aspect-ratio: 2/3; border-radius: 6px; background: var(--surface-2); animation: pulse 1.2s ease-in-out infinite alternate; }
  @keyframes pulse { to { opacity: 0.5; } }
</style>
