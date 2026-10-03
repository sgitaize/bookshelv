<script lang="ts">
  import { fly } from 'svelte/transition';
  import { router } from './lib/router.svelte.ts';
  import { session, loadSession, toasts } from './lib/state.svelte.ts';
  import Nav from './components/Nav.svelte';
  import Auth from './routes/Auth.svelte';
  import Shelf from './routes/Shelf.svelte';
  import Home from './routes/Home.svelte';
  import Profile from './routes/Profile.svelte';
  import Add from './routes/Add.svelte';
  import Book from './routes/Book.svelte';
  import People from './routes/People.svelte';
  import Settings from './routes/Settings.svelte';
  import Admin from './routes/Admin.svelte';

  loadSession().catch(() => (session.me = null));

  const invite = $derived(router.match('/invite/:token'));
  const book = $derived(router.match('/book/:id'));
  const person = $derived(router.match('/people/:id'));
  const personShelf = $derived(router.match('/people/:id/shelf'));
</script>

{#if session.me === undefined}
  <div class="boot"><div class="spinner"></div></div>
{:else if session.me === null}
  {#if invite}
    <Auth mode="register" inviteToken={invite.token} />
  {:else if session.needsSetup}
    <Auth mode="setup" />
  {:else}
    <Auth mode="login" />
  {/if}
{:else}
  <Nav />
  <main>
    {#key router.path + router.query.toString()}
      <div in:fly={{ y: 8, duration: 180 }}>
        {#if router.path === '/'}<Home />
        {:else if router.path === '/library'}<Shelf />
        {:else if router.path === '/me'}<Profile />
        {:else if router.path === '/add'}<Add />
        {:else if book}<Book id={Number(book.id)} />
        {:else if router.path === '/people'}<People />
        {:else if person}<Profile userId={Number(person.id)} />
        {:else if personShelf}<Shelf userId={Number(personShelf.id)} />
        {:else if router.path === '/settings'}<Settings />
        {:else if router.path === '/admin' && session.me.isAdmin}<Admin />
        {:else if invite}
          <div class="empty"><h2>Du bist schon angemeldet</h2><p>Gib den Einladungslink an die Person weiter, für die er gedacht ist.</p><a class="btn" href="/">Zum Regal</a></div>
        {:else}
          <div class="empty"><h2>Seite nicht gefunden</h2><a class="btn" href="/">Zum Regal</a></div>
        {/if}
      </div>
    {/key}
  </main>
{/if}

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast {t.kind}" transition:fly={{ y: 20, duration: 200 }}>{t.text}</div>
  {/each}
</div>

<style>
  .boot { min-height: 100dvh; display: grid; place-items: center; }
  main {
    max-width: var(--content-w);
    margin: 0 auto;
    padding: 1.2rem 1.2rem calc(var(--nav-h) + 2.5rem + env(safe-area-inset-bottom));
  }
  @media (min-width: 1000px) { main { padding: 1.6rem 2rem 3rem; } }
  .toasts {
    position: fixed; z-index: 100; left: 50%; translate: -50% 0;
    bottom: calc(var(--nav-h) + 16px + env(safe-area-inset-bottom));
    display: grid; gap: 0.5rem; width: min(420px, 92vw); pointer-events: none;
  }
  @media (min-width: 1000px) { .toasts { bottom: 24px; } }
  .toast {
    padding: 0.75rem 1.1rem; border-radius: 12px; font-weight: 550;
    background: var(--text); color: var(--bg); box-shadow: var(--shadow); text-align: center;
  }
  .toast.error { background: var(--danger); color: #fff; }
</style>
