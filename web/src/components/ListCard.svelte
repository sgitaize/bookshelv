<script lang="ts">
  import type { ReadingListSummary } from '../lib/api.ts';
  import { t, tn } from '../lib/i18n.svelte.ts';
  import Cover from './Cover.svelte';
  import Icon from './Icon.svelte';

  let { list }: { list: ReadingListSummary } = $props();
</script>

<a class="card lc" href="/lists/{list.id}">
  <div class="stackc" aria-hidden="true">
    {#each list.preview.slice(0, 3) as b, i (b.id)}
      <div class="c" style="--i: {i}"><Cover url={b.coverUrl} title={b.title} authors={b.authors} size="sm" /></div>
    {:else}
      <div class="ph"><Icon name="list" size={28} /></div>
    {/each}
  </div>
  <strong class="name">{list.name}</strong>
  <span class="muted small">{tn('list.books', list.count)}{#if list.visibility === 'private'} · {t('vis.private')}{/if}{#if list.owner} · {t('list.byOwner', { name: list.owner.displayName })}{:else if list.shared} · {t('list.sharedBadge')}{/if}</span>
</a>

<style>
  .lc { display: grid; gap: 0.25rem; padding: 0.7rem; color: var(--text); min-width: 0; }
  .lc:hover { text-decoration: none; border-color: var(--surface-3); }
  /* bis zu drei Cover leicht versetzt übereinander, wie ein kleiner Stapel */
  .stackc { position: relative; height: 104px; margin-bottom: 0.3rem; }
  .c { position: absolute; top: calc(var(--i) * 6px); left: calc(var(--i) * 26%); width: 48%; max-width: 70px; z-index: calc(3 - var(--i)); box-shadow: 2px 2px 8px rgb(0 0 0 / 0.3); border-radius: 4px; }
  .ph { height: 100%; display: grid; place-items: center; background: var(--surface-2); border-radius: 8px; color: var(--muted); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
