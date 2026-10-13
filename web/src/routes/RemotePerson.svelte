<script lang="ts">
  // Person auf einer gekoppelten Instanz: Profilkarte, Freundschaft, Regal (live von dort abgefragt)
  import { api, type Relation } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import Avatar from '../components/Avatar.svelte';
  import Cover from '../components/Cover.svelte';
  import FriendButton from '../components/FriendButton.svelte';
  import { t, tn, type Key } from '../lib/i18n.svelte.ts';

  let { id }: { id: number } = $props();
  type Card = { actorId: number; displayName: string; username: string; handle: string; instance: string; relation: Relation };
  type RemoteCopy = { format: string; readStatus: string; isbn13: string | null; localBookId: number | null;
    book: { id: number; title: string; authors: string[]; coverUrl: string | null } };
  let card = $state<Card | null>(null);
  let shelf = $state<{ visible: boolean; copies: RemoteCopy[] } | null>(null);
  let shelfError = $state(false);
  let q = $state('');

  function load() {
    api.get<Card>(`/remote/${id}`).then(r => {
      card = r;
      shelf = null; shelfError = false;
      if (r.relation === 'friend') api.get<{ visible: boolean; copies: RemoteCopy[] }>(`/remote/${id}/shelf`).then(s => (shelf = s)).catch(() => (shelfError = true));
    }).catch(toastError);
  }
  $effect(() => { load(); });
  const shown = $derived((shelf?.copies ?? []).filter(c => !q.trim() || `${c.book.title} ${c.book.authors.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())));
  const href = (c: RemoteCopy) => (c.localBookId ? `/book/${c.localBookId}` : c.isbn13 ? `/add?tab=search&q=${c.isbn13}` : null);
</script>

{#if !card}
  <div class="spinner"></div>
{:else}
  <section class="stack">
    <div class="head">
      <Avatar name={card.displayName} url={null} size={72} />
      <h1>{card.displayName}</h1>
      <p class="muted small">{card.handle} · {card.instance}</p>
      <FriendButton userId={card.actorId} remote bind:relation={card.relation} onchange={load} />
    </div>
    {#if card.relation !== 'friend'}
      <p class="muted center">{t('profile.notFriend')}</p>
    {:else if shelfError}
      <p class="muted center">{t('remote.unreachable')}</p>
    {:else if !shelf}
      <div class="spinner"></div>
    {:else if !shelf.visible}
      <p class="muted center">{t('profile.private')}</p>
    {:else}
      <div class="spread"><h2>{tn('n.books', shelf.copies.length)}</h2></div>
      {#if shelf.copies.length > 12}<input type="search" bind:value={q} placeholder={t('bp.filter')} />{/if}
      <div class="grid">
        {#each shown as c, i (i)}
          {@const h = href(c)}
          <svelte:element this={h ? 'a' : 'div'} class="item" href={h}>
            <Cover url={c.book.coverUrl} title={c.book.title} authors={c.book.authors} />
            <span class="title">{c.book.title}</span>
            <span class="muted small">{t(`read.${c.readStatus}` as Key)}{#if c.format !== 'print'} · {t(`format.${c.format}` as Key)}{/if}</span>
          </svelte:element>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .head { display: grid; justify-items: center; text-align: center; gap: 0.3rem; }
  .head h1 { margin: 0.4rem 0 0; font-size: 1.3rem; overflow-wrap: anywhere; }
  .head p { margin: 0; overflow-wrap: anywhere; }
  .center { text-align: center; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(110px, 30%), 1fr)); gap: 1rem 0.7rem; }
  .item { display: grid; gap: 0.25rem; align-content: start; color: var(--text); min-width: 0; }
  .item:hover { text-decoration: none; }
  .title { font-size: 0.85rem; font-weight: 500; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
