<script lang="ts">
  import { api, type BookBrief } from '../lib/api.ts';
  import { session, toastError } from '../lib/state.svelte.ts';
  import { t, fmtDate } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';

  // ohne userId: eigene Wunschliste; sonst die eines Freundes (Geschenkideen)
  let { userId }: { userId?: number } = $props();
  type Wish = { note: string | null; addedAt: string; book: BookBrief };
  let items = $state<Wish[] | null>(null);
  let ownerName = $state('');
  const own = $derived(!userId || userId === session.me?.id);

  $effect(() => {
    items = null;
    api.get<Wish[]>(own ? '/wishlist' : `/users/${userId}/wishlist`).then(r => (items = r)).catch(toastError);
    if (!own) api.get<{ displayName: string }>(`/users/${userId}/profile`).then(p => (ownerName = p.displayName)).catch(() => {});
  });

  async function remove(w: Wish) {
    try {
      await api.del(`/books/${w.book.id}/wishlist`);
      items = items!.filter(x => x !== w);
    } catch (e) { toastError(e); }
  }
</script>

<section class="stack">
  <h1>{own ? t('wish.title') : t('wish.of', { name: ownerName })}</h1>
  {#if own}<p class="muted">{t('wish.info')}</p>{/if}
  {#if items === null}
    <div class="spinner"></div>
  {:else if !items.length}
    <div class="empty">
      <p>{own ? t('wish.empty') : t('wish.emptyOther')}</p>
      {#if own}<a class="btn primary" href="/add?tab=search"><Icon name="search" size={16} /> {t('add.title')}</a>{/if}
    </div>
  {:else}
    <div class="list">
      {#each items as w (w.book.id)}
        <div class="card item">
          <a href="/book/{w.book.id}"><Cover url={w.book.coverUrl} title={w.book.title} authors={w.book.authors} size="sm" /></a>
          <div class="body">
            <a href="/book/{w.book.id}" class="title">{w.book.title}</a>
            <span class="muted small">{w.book.authors.join(', ')}</span>
            {#if w.note}<span class="small">{w.note}</span>{/if}
            <span class="muted small">{t('wish.since', { d: fmtDate(w.addedAt) })}</span>
          </div>
          {#if own}<button class="icon ghost" onclick={() => remove(w)} aria-label={t('wish.remove')}><Icon name="x" size={18} /></button>{/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .list { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  @media (max-width: 400px) { .list { grid-template-columns: 1fr; } }
  .item { display: flex; gap: 0.9rem; align-items: center; padding: 0.8rem; }
  .body { flex: 1; min-width: 0; display: grid; gap: 0.1rem; }
  .title { color: var(--text); font-weight: 600; }
</style>
