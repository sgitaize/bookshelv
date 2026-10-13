<script lang="ts">
  import { api, type Relation } from '../lib/api.ts';
  import { session, toastError } from '../lib/state.svelte.ts';
  import Icon from '../components/Icon.svelte';
  import Avatar from '../components/Avatar.svelte';
  import FriendButton from '../components/FriendButton.svelte';
  import { t, tn } from '../lib/i18n.svelte.ts';

  type Person = { id: number; displayName: string; username: string; shelfVisible: boolean; copies: number | null; avatarUrl: string | null; relation: Relation };
  type Remote = { actorId: number; displayName: string; username: string; handle: string; instance: string; relation: Relation };
  let people = $state<Person[] | null>(null);
  let remote = $state<Remote[]>([]);
  let linked = $state(false);
  let found = $state<Remote | null>(null);
  let searching = $state(false);
  let q = $state('');

  const load = () => {
    api.get<Person[]>('/users').then(r => (people = r)).catch(toastError);
    api.get<{ linked: boolean; people: Remote[] }>('/friends/remote').then(r => { remote = r.people; linked = r.linked; }).catch(() => {});
  };
  // „@anna@books.example“ → bei der gekoppelten Instanz nachschlagen
  const isHandle = $derived(/^@?[a-z0-9._-]{3,32}@[a-z0-9.-]+(:\d+)?$/i.test(q.trim()));
  async function lookup() {
    searching = true; found = null;
    try { found = await api.post<Remote>('/friends/remote/lookup', { handle: q.trim() }); } catch (e) { toastError(e); } finally { searching = false; }
  }
  $effect(() => { load(); });

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const shown = $derived.by(() => {
    const n = norm(q.trim().replace(/^@/, ''));
    return (people ?? []).filter(p => !n || norm(`${p.displayName} ${p.username}`).includes(n));
  });
  const group = (rels: Relation[]) => shown.filter(p => rels.includes(p.relation));
  const rgroup = (rel: Relation) => remote.filter(p => p.relation === rel && (!q.trim() || norm(`${p.displayName} ${p.handle}`).includes(norm(q.trim()))));
  const incoming = $derived(group(['incoming']));
  const friends = $derived(group(['self', 'friend']));
  const outgoing = $derived(group(['outgoing']));
  const others = $derived(group(['none']));
</script>

<section class="stack">
  <div class="spread">
    <h1>{t('nav.friends')}</h1>
    <a href="/settings?s=invites" class="btn"><Icon name="link" size={16} /> {t('people.invite')}</a>
  </div>
  <input type="search" bind:value={q} placeholder={t('people.search')} aria-label={t('people.search')} oninput={() => (found = null)} />
  {#if linked && isHandle}
    <button class="btn lookup" onclick={lookup} disabled={searching}><Icon name="search" size={16} /> {t('people.lookup', { host: q.trim().split('@').at(-1) ?? '' })}</button>
  {:else if linked}
    <p class="muted small hint">{t('people.remoteHint')}</p>
  {/if}
  {#if found}<div class="list">{@render rcard(found)}</div>{/if}

  {#snippet card(p: Person)}
    {@const me = p.id === session.me?.id}
    <div class="card person" class:locked={!p.shelfVisible && !me}>
      <a class="who" href={me ? '/me' : `/people/${p.id}`}>
        <Avatar name={p.displayName} url={p.avatarUrl} size={44} />
        <span class="grow">
          <strong>{p.displayName}{#if me} <span class="muted">{t('people.you')}</span>{/if}</strong>
          <span class="muted small">@{p.username}</span>
        </span>
        {#if p.relation === 'friend' || me}<span class="muted small">{p.copies === null ? t('people.private') : tn('n.books', p.copies)}</span>{/if}
      </a>
      {#if !me && p.relation !== 'friend'}<FriendButton userId={p.id} bind:relation={p.relation} compact onchange={load} />{/if}
    </div>
  {/snippet}

  {#snippet rcard(p: Remote)}
    <div class="card person">
      <a class="who" href={`/people/remote/${p.actorId}`}>
        <Avatar name={p.displayName} url={null} size={44} />
        <span class="grow"><strong>{p.displayName}</strong><span class="muted small">{p.handle}</span></span>
      </a>
      {#if p.relation !== 'friend'}<FriendButton userId={p.actorId} remote bind:relation={p.relation} compact onchange={load} />{/if}
    </div>
  {/snippet}

  {#if !people}
    <div class="spinner"></div>
  {:else}
    {#if incoming.length || rgroup('incoming').length}
      <h2>{t('people.incoming')}</h2>
      <div class="list">{#each incoming as p (p.id)}{@render card(p)}{/each}{#each rgroup('incoming') as p (p.actorId)}{@render rcard(p)}{/each}</div>
    {/if}
    <h2>{t('people.friends')}</h2>
    {#if friends.length || rgroup('friend').length}
      <div class="list">{#each friends as p (p.id)}{@render card(p)}{/each}{#each rgroup('friend') as p (p.actorId)}{@render rcard(p)}{/each}</div>
    {:else}<p class="muted small">{t('people.noMatch')}</p>{/if}
    {#if outgoing.length || rgroup('outgoing').length}
      <h2>{t('people.outgoing')}</h2>
      <div class="list">{#each outgoing as p (p.id)}{@render card(p)}{/each}{#each rgroup('outgoing') as p (p.actorId)}{@render rcard(p)}{/each}</div>
    {/if}
    {#if others.length}
      <h2>{t('people.others')}</h2>
      <p class="muted small">{t('people.othersHint')}</p>
      <div class="list">{#each others as p (p.id)}{@render card(p)}{/each}</div>
    {/if}
  {/if}
</section>

<style>
  h2 { margin: 0.6rem 0 0; font-size: 1.05rem; }
  .lookup { justify-self: start; }
  .hint { margin: -0.3rem 0 0; }
  .list { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .person { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 0.9rem; padding: 0.9rem 1rem; }
  .who { display: flex; align-items: center; gap: 0.9rem; flex: 1 1 12rem; min-width: 0; color: var(--text); }
  .who:hover { text-decoration: none; }
  .person.locked { opacity: 0.75; }
  .grow { flex: 1; display: grid; min-width: 0; }
  .grow strong, .grow span { overflow-wrap: anywhere; }
</style>
