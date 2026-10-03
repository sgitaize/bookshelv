<script lang="ts">
  import { api, type FeedItem } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import FeedList from '../components/FeedList.svelte';

  let items = $state<FeedItem[] | null>(null);
  let next = $state<string | null>(null);
  let busy = $state(false);

  async function load(before?: string) {
    busy = true;
    try {
      const r = await api.get<{ items: FeedItem[]; next: string | null }>(`/feed${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      items = [...(before ? items ?? [] : []), ...r.items];
      next = r.next;
    } catch (e) { toastError(e); } finally { busy = false; }
  }
  $effect(() => { load(); });
</script>

<section class="stack">
  <h1>{t('feed.title')}</h1>
  {#if items === null}
    <div class="spinner"></div>
  {:else if !items.length}
    <p class="empty">{t('feed.empty')}</p>
  {:else}
    <FeedList {items} />
    {#if next}<button class="more" onclick={() => load(next!)} disabled={busy}>{t('feed.more')}</button>{/if}
  {/if}
</section>

<style>
  .more { justify-self: center; }
</style>
