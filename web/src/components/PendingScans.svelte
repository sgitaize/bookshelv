<script lang="ts">
  import { api, ApiError, type Book, type Copy } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { t, i18n } from '../lib/i18n.svelte.ts';
  import { pending, dropScan, isNetworkError, net, type PendingScan } from '../lib/offline.svelte.ts';
  import Cover from './Cover.svelte';
  import Icon from './Icon.svelte';

  // Offline gescannte ISBNs nachschlagen und nach Bestätigung übernehmen
  type Row = PendingScan & { state: 'new' | 'looking' | 'found' | 'missing' | 'owned'; book?: Book };
  let rows = $state<Row[]>(pending.items.map(p => ({ ...p, state: 'new' })));
  let busy = $state(false);
  $effect(() => {
    // neue Scans (z. B. aus einem anderen Tab) dazunehmen, erledigte entfernen
    const known = new Set(rows.map(r => r.isbn + r.target));
    const keep = new Set(pending.items.map(p => p.isbn + p.target));
    rows = [...rows.filter(r => keep.has(r.isbn + r.target)), ...pending.items.filter(p => !known.has(p.isbn + p.target)).map(p => ({ ...p, state: 'new' as const }))];
  });
  const found = $derived(rows.filter(r => r.state === 'found'));

  async function lookupAll() {
    busy = true;
    for (const r of rows.filter(x => x.state === 'new' || x.state === 'missing')) {
      r.state = 'looking';
      try {
        r.book = (await api.post<{ book: Book }>('/catalog/isbn', { isbn: r.isbn })).book;
        const detail = await api.get<{ copies: Copy[]; wishlisted: boolean }>(`/books/${r.book.id}`);
        r.state = (r.target === 'wishlist' ? detail.wishlisted || detail.copies.some(c => c.mine) : detail.copies.some(c => c.mine && c.format === (r.format ?? 'print'))) ? 'owned' : 'found';
      } catch (e) {
        if (isNetworkError(e)) { net.online = false; r.state = 'new'; break; }
        r.state = e instanceof ApiError && e.status === 404 ? 'missing' : 'new';
        if (!(e instanceof ApiError && e.status === 404)) toastError(e);
      }
    }
    busy = false;
  }

  async function accept(r: Row) {
    if (!r.book) return;
    if (r.target === 'wishlist') await api.put(`/books/${r.book.id}/wishlist`, {});
    else await api.post('/copies', { bookId: r.book.id, format: r.format ?? 'print', binding: r.format === 'ebook' ? null : r.binding ?? null, sprayedEdges: false, notes: '', storeId: null });
    dropScan(r.isbn, r.target);
  }

  async function acceptAll() {
    busy = true;
    let n = 0;
    try { for (const r of found) { await accept(r); n++; } toast(t('offline.doneN', { n })); }
    catch (e) { toastError(e); } finally { busy = false; }
  }
  async function acceptOne(r: Row) {
    try { await accept(r); toast(r.target === 'wishlist' ? t('wish.addedTitle', { title: r.book!.title }) : t('add.added', { title: r.book!.title })); } catch (e) { toastError(e); }
  }
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.locale, { dateStyle: 'short', timeStyle: 'short' });
</script>

<div class="card stack ps">
  <div class="spread">
    <h2>{t('offline.pendingTitle', { n: rows.length })}</h2>
    {#if rows.some(r => r.state === 'new' || r.state === 'missing')}
      <button class="primary small" onclick={lookupAll} disabled={busy || !net.online}><Icon name="search" size={16} /> {t('offline.lookupAll')}</button>
    {:else if found.length}
      <button class="primary small" onclick={acceptAll} disabled={busy}><Icon name="check" size={16} /> {t('offline.acceptAll', { n: found.length })}</button>
    {/if}
  </div>
  <p class="muted small">{t('offline.pendingInfo')}</p>
  {#each rows as r (r.isbn + r.target)}
    <div class="row prow">
      <span class="pcov">{#if r.book}<Cover url={r.book.coverUrl} title={r.book.title} authors={r.book.authors} size="sm" />{:else}<Icon name="scan" size={22} />{/if}</span>
      <span class="grow">
        <strong>{r.book?.title ?? r.isbn}</strong>
        <span class="muted small">
          {r.target === 'wishlist' ? t('scan.toWishlist') : t('scan.toShelf')} · {when(r.at)}
          {#if r.state === 'looking'} · {t('add.looking', { isbn: r.isbn })}{/if}
          {#if r.state === 'missing'} · {t('add.notFound')}{/if}
          {#if r.state === 'owned'} · {t('offline.owned')}{/if}
        </span>
      </span>
      {#if r.state === 'found'}<button class="icon ghost" onclick={() => acceptOne(r)} aria-label={t('offline.accept')}><Icon name="check" size={18} /></button>{/if}
      {#if r.state === 'missing'}<a class="btn small ghost" href="/add?tab=manual&isbn={r.isbn}">{t('add.manual')}</a>{/if}
      <button class="icon ghost" onclick={() => dropScan(r.isbn, r.target)} aria-label={t('offline.discard')}><Icon name="x" size={18} /></button>
    </div>
  {/each}
</div>

<style>
  .ps { padding: 0.9rem 1rem; }
  .ps h2 { margin: 0; }
  .prow { flex-wrap: nowrap; gap: 0.7rem; }
  .pcov { width: 40px; flex: none; display: grid; place-items: center; color: var(--muted); }
  .grow { flex: 1; min-width: 0; display: grid; }
  .grow strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
