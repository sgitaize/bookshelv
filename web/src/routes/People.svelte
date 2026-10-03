<script lang="ts">
  import { api } from '../lib/api.ts';
  import { session, toastError } from '../lib/state.svelte.ts';
  import Icon from '../components/Icon.svelte';
  import Avatar from '../components/Avatar.svelte';
  import { t, tn, i18n, fmtDate } from '../lib/i18n.svelte.ts';

  type Person = { id: number; displayName: string; username: string; shelfVisible: boolean; copies: number | null; avatarUrl: string | null };
  let people = $state<Person[] | null>(null);

  $effect(() => { api.get<Person[]>('/users').then(r => (people = r)).catch(toastError); });
</script>

<section class="stack">
  <div class="spread">
    <h1>{t('nav.friends')}</h1>
    <a href="/settings?s=invites" class="btn"><Icon name="link" size={16} /> {t('people.invite')}</a>
  </div>

  {#if !people}
    <div class="spinner"></div>
  {:else}
    <div class="list">
      {#each people as p (p.id)}
        {@const me = p.id === session.me?.id}
        <a class="card person" class:locked={!p.shelfVisible && !me} href={me ? '/me' : `/people/${p.id}`}>
          <Avatar name={p.displayName} url={p.avatarUrl} size={44} />
          <span class="grow">
            <strong>{p.displayName}{#if me} <span class="muted">{t('people.you')}</span>{/if}</strong>
            <span class="muted small">@{p.username}</span>
          </span>
          <span class="muted small">{p.copies === null ? t('people.private') : tn('n.books', p.copies)}</span>
        </a>
      {/each}
    </div>
  {/if}
</section>

<style>
  .list { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .person { display: flex; align-items: center; gap: 0.9rem; padding: 0.9rem 1rem; color: var(--text); }
  .person:hover { text-decoration: none; border-color: var(--surface-3); }
  .person.locked { opacity: 0.75; }
  .grow { flex: 1; display: grid; min-width: 0; }
</style>
