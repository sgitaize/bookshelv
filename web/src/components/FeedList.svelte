<script lang="ts">
  import { ago, fmtRating, type FeedItem } from '../lib/api.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Avatar from './Avatar.svelte';
  import Cover from './Cover.svelte';
  import Stars from './Stars.svelte';

  let { items }: { items: FeedItem[] } = $props();
  const verb = (f: FeedItem) => t(f.type === 'started' ? 'feed.started' : f.type === 'finished' ? 'feed.finished' : 'feed.reviewed');
</script>

<div class="feed">
  {#each items as f, i (i + f.type + f.ts + f.book.id)}
    <a class="card item" href="/book/{f.book.id}">
      <Cover url={f.book.coverUrl} title={f.book.title} authors={f.book.authors} size="sm" />
      <div class="body">
        <p class="line"><Avatar name={f.user.displayName} url={f.user.avatarUrl} size={22} /> <strong>{f.user.displayName}</strong> {verb(f)}</p>
        <p class="title">{f.book.title}</p>
        {#if f.rating}<p class="rate"><Stars value={f.rating} size={14} /> <b>{fmtRating(f.rating)}/5</b></p>{/if}
        {#if f.text}<p class="snippet muted">{f.text}</p>{:else if f.spoiler}<p class="snippet muted">{t('review.hasSpoiler')}</p>{/if}
        <p class="muted small">{ago(f.ts)}</p>
      </div>
    </a>
  {/each}
</div>

<style>
  .feed { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  @media (max-width: 400px) { .feed { grid-template-columns: 1fr; } }
  .item { display: flex; gap: 0.9rem; padding: 0.8rem; color: var(--text); align-items: flex-start; }
  .item:hover { text-decoration: none; border-color: var(--surface-3); }
  .body { min-width: 0; display: grid; gap: 0.2rem; }
  .body p { margin: 0; }
  .line { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
  .title { font-weight: 600; }
  .rate { display: flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; }
  .snippet { font-size: 0.88rem; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
</style>
