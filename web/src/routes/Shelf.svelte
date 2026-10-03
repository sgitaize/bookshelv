<script lang="ts">
  import { api, labels, type ShelfItem } from '../lib/api.ts';
  import { session, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';

  // ohne userId: eigenes Regal; mit userId: Regal eines Freundes (nur lesen)
  let { userId }: { userId?: number } = $props();

  let items = $state<ShelfItem[] | null>(null);
  let ownerName = $state('');
  let q = $state('');
  type Filter = 'all' | 'print' | 'ebook' | 'unread' | 'reading' | 'read' | 'lent' | 'edges' | 'favorite';
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
    ['all', 'Alle'], ['print', 'Gedruckt'], ['ebook', 'E-Books'], ['unread', 'Ungelesen'], ['reading', 'Am Lesen'],
    ['read', 'Gelesen'], ['favorite', 'Favoriten'], ...(own ? [['lent', 'Verliehen']] : []), ['edges', 'Farbschnitt']
  ] as [Filter, string][]);

  const shown = $derived.by(() => {
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
    return sort === 'added' ? list : [...list].sort((a, b) => key(a).localeCompare(key(b), 'de'));
  });
</script>

<section>
  <div class="spread head">
    <div>
      <h1>{own ? 'Meine Bibliothek' : `Regal von ${ownerName}`}</h1>
      {#if items}<p class="muted">{items.length} {items.length === 1 ? 'Buch' : 'Bücher'}{#if shown.length !== items.length} · {shown.length} angezeigt{/if}</p>{/if}
    </div>
  </div>

  {#if items && items.length}
    <div class="tools">
      <div class="searchbox">
        <Icon name="search" size={18} />
        <input bind:value={q} placeholder="Titel oder Autor filtern" type="search" />
      </div>
      <select bind:value={sort} aria-label="Sortierung">
        <option value="added">Neueste</option>
        <option value="title">Titel</option>
        <option value="author">Autor</option>
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
  {:else if items.length === 0}
    <div class="empty">
      <h2>{own ? 'Noch leer hier' : 'Noch keine Bücher'}</h2>
      {#if own}
        <p>Scanne den Barcode auf der Rückseite eines Buchs – oder such es nach Titel.</p>
        <a href="/add" class="btn primary"><Icon name="scan" size={18} /> Erstes Buch hinzufügen</a>
      {/if}
    </div>
  {:else}
    <div class="grid">
      {#each shown as it (it.id)}
        <a class="item" href="/book/{it.book.id}">
          <div class="cv">
            <Cover url={it.book.coverUrl} title={it.book.title} authors={it.book.authors} />
            <div class="badges">
              {#if it.lent}<span class="chip accent">verliehen</span>{/if}
              {#if it.format === 'ebook'}<span class="chip">E-Book</span>{/if}
              {#if it.sprayedEdges}<span class="chip edge">Farbschnitt</span>{/if}
            </div>
            {#if it.readStatus !== 'unread'}<span class="status {it.readStatus}" title={labels.read[it.readStatus]}></span>{/if}
          </div>
          <div class="t">{it.book.title}</div>
          <div class="a muted">{it.book.authors.join(', ')}</div>
        </a>
      {/each}
    </div>
    {#if !shown.length}<p class="empty">Nichts gefunden.</p>{/if}
  {/if}
</section>

<style>
  .head { margin-bottom: 1rem; align-items: flex-end; }
  .head p { margin: 0; }
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
