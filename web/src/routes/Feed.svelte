<script lang="ts">
  import { api, type FeedItem } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import FeedList from '../components/FeedList.svelte';

  type Scope = 'friends' | 'me' | 'all';
  // ?user=<id> zeigt die Aktivität einer Person (vom Profil aus)
  const user = $derived(Number(router.query.get('user')) || null);
  let scope = $state<Scope>((router.query.get('scope') as Scope) ?? 'friends');
  let items = $state<FeedItem[] | null>(null);
  let next = $state<string | null>(null);
  let busy = $state(false);

  async function load(before?: string) {
    busy = true;
    try {
      const q = new URLSearchParams(user ? { user: String(user) } : { scope });
      if (before) q.set('before', before);
      const r = await api.get<{ items: FeedItem[]; next: string | null }>(`/feed?${q}`);
      items = [...(before ? items ?? [] : []), ...r.items];
      next = r.next;
    } catch (e) { toastError(e); } finally { busy = false; }
  }
  $effect(() => { scope; items = null; load(); });
</script>

<section class="stack">
  <h1>{user ? t('feed.userTitle') : t('feed.activity')}</h1>
  {#if !user}
    <div class="segmented">
      <button class:active={scope === 'friends'} onclick={() => (scope = 'friends')}>{t('feed.scopeFriends')}</button>
      <button class:active={scope === 'me'} onclick={() => (scope = 'me')}>{t('feed.scopeMe')}</button>
      <button class:active={scope === 'all'} onclick={() => (scope = 'all')}>{t('feed.scopeAll')}</button>
    </div>
  {/if}
  {#if items === null}
    <div class="spinner"></div>
  {:else if !items.length}
    <p class="empty">{scope === 'me' && !user ? t('feed.emptyMe') : t('feed.empty')}</p>
  {:else}
    <FeedList {items} />
    {#if next}<button class="more" onclick={() => load(next!)} disabled={busy}>{t('feed.more')}</button>{/if}
  {/if}
</section>

<style>
  .more { justify-self: center; }
  .segmented { justify-self: start; }
</style>
