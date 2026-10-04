<script lang="ts">
  // Übersicht der eigenen Leserunden
  import { api, type BuddyRead } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t, tn } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Avatar from '../components/Avatar.svelte';

  let reads = $state<BuddyRead[] | null>(null);
  $effect(() => { api.get<BuddyRead[]>('/reads').then(r => (reads = r)).catch(toastError); });
</script>

<section class="stack">
  <h1>{t('reads.title')}</h1>
  <p class="muted">{t('reads.intro')}</p>
  {#if !reads}
    <div class="spinner"></div>
  {:else if !reads.length}
    <p class="empty">{t('reads.none')}</p>
  {:else}
    <div class="list">
      {#each reads as r (r.id)}
        <a class="card item" href="/reads/{r.id}">
          <Cover url={r.book.coverUrl} title={r.book.title} authors={r.book.authors} size="sm" />
          <div class="body">
            <strong class="ttl">{r.book.title}</strong>
            <div class="faces">
              {#each r.members.slice(0, 6) as m (m.id)}<Avatar name={m.displayName} url={m.avatarUrl} size={22} />{/each}
              <span class="muted small">{tn('reads.nPeople', r.members.length)}</span>
            </div>
            <span class="muted small">{t('reads.yourPos', { n: r.myPosition })} · {tn('reads.nPosts', r.posts ?? 0)}{#if r.unseen}{' · '}<b class="new">{t('reads.new', { n: r.unseen })}</b>{/if}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</section>

<style>
  .list { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  @media (max-width: 400px) { .list { grid-template-columns: 1fr; } }
  .item { display: flex; gap: 0.8rem; padding: 0.8rem; color: var(--text); align-items: center; }
  .item:hover { text-decoration: none; }
  .body { display: grid; gap: 0.3rem; min-width: 0; }
  .ttl { overflow-wrap: anywhere; }
  .faces { display: flex; align-items: center; gap: 0.15rem; flex-wrap: wrap; }
  .faces span { margin-left: 0.35rem; }
  .new { color: var(--accent); }
</style>
