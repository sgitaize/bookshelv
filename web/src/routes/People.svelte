<script lang="ts">
  import { api } from '../lib/api.ts';
  import { session, toastError } from '../lib/state.svelte.ts';
  import Icon from '../components/Icon.svelte';

  type Person = { id: number; displayName: string; username: string; shelfVisible: boolean; copies: number | null };
  let people = $state<Person[] | null>(null);

  $effect(() => { api.get<Person[]>('/users').then(r => (people = r)).catch(toastError); });
</script>

<section class="stack">
  <div class="spread">
    <h1>Freunde</h1>
    <a href="/settings#invites" class="btn"><Icon name="link" size={16} /> Jemanden einladen</a>
  </div>

  {#if !people}
    <div class="spinner"></div>
  {:else}
    <div class="list">
      {#each people as p (p.id)}
        {@const me = p.id === session.me?.id}
        <a class="card person" class:locked={!p.shelfVisible && !me} href={me ? '/me' : `/people/${p.id}`}>
          <span class="avatar" style="--h: {(p.id * 67) % 360}">{p.displayName.slice(0, 1).toUpperCase()}</span>
          <span class="grow">
            <strong>{p.displayName}{#if me} <span class="muted">(du)</span>{/if}</strong>
            <span class="muted small">@{p.username}</span>
          </span>
          <span class="muted small">{p.copies === null ? 'privat' : `${p.copies} ${p.copies === 1 ? 'Buch' : 'Bücher'}`}</span>
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
  .avatar {
    width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0;
    font-weight: 700; font-size: 1.2rem;
    background: var(--accent-soft); color: var(--accent);
  }
</style>
