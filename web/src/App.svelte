<script lang="ts">
  import { fly } from 'svelte/transition';
  import { router } from './lib/router.svelte.ts';
  import { session, loadSession, loadInstance, toasts, toast, pollNotifications } from './lib/state.svelte.ts';
  import { api } from './lib/api.ts';
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
  import Loans from './routes/Loans.svelte';
  import History from './routes/History.svelte';
  import Notifications from './routes/Notifications.svelte';
  import Privacy from './routes/Privacy.svelte';
  import Feed from './routes/Feed.svelte';
  import Wishlist from './routes/Wishlist.svelte';
  import Import from './routes/Import.svelte';
  import Lists from './routes/Lists.svelte';
  import Imports from './routes/Imports.svelte';
  import ListView from './routes/ListView.svelte';
  import Stats from './routes/Stats.svelte';
  import Wrapup from './routes/Wrapup.svelte';
  import { t } from './lib/i18n.svelte.ts';
  import { net, writes, flushWrites } from './lib/offline.svelte.ts';

  loadSession().catch(() => (session.me = null));
  loadInstance();

  // Glocke aktuell halten: bei jedem Seitenwechsel (gedrosselt) und jede Minute
  $effect(() => { router.path; if (session.me && net.online) pollNotifications(); });
  // wieder online → Konto und Daten frisch laden
  let wasOffline = false;
  $effect(() => {
    if (!net.online) wasOffline = true;
    else if (wasOffline) { wasOffline = false; loadSession().then(sync).catch(() => {}); }
  });
  // offline vorgemerkte Änderungen nachreichen (auch beim Start, falls die App offline geschlossen wurde)
  async function sync() {
    if (!session.me || !net.online || !writes.items.length) return;
    const r = await flushWrites(api.sendPut);
    if (r.ok) toast(t('offline.synced', { n: r.ok }));
    if (r.failed) toast(t('offline.syncFailed', { n: r.failed }), 'error');
  }
  $effect(() => { if (session.me) sync(); });
  $effect(() => {
    const id = setInterval(() => pollNotifications(true), 60_000);
    return () => clearInterval(id);
  });

  const invite = $derived(router.match('/invite/:token'));
  const book = $derived(router.match('/book/:id'));
  const person = $derived(router.match('/people/:id'));
  const personShelf = $derived(router.match('/people/:id/shelf'));
  const personWish = $derived(router.match('/people/:id/wishlist'));
  const listView = $derived(router.match('/lists/:id'));
</script>

{#if session.me === undefined}
  <div class="boot"><div class="spinner"></div></div>
{:else if session.me === null && router.path === '/privacy'}
  <main><Privacy /></main>
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
  {#if !net.online}<div class="offbar" role="status">{t('offline.bar')}{#if writes.items.length} {t('offline.barQueued', { n: writes.items.length })}{/if} <a href="/add">{t('offline.barScan')}</a></div>{/if}
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
        {:else if router.path === '/loans'}<Loans />
        {:else if router.path === '/history'}<History />
        {:else if router.path === '/notifications'}<Notifications />
        {:else if router.path === '/feed'}<Feed />
        {:else if router.path === '/wishlist'}<Wishlist />
        {:else if personWish}<Wishlist userId={Number(personWish.id)} />
        {:else if router.path === '/import'}<Import />
        {:else if router.path === '/lists'}<Lists />
        {:else if router.path === '/imports'}<Imports />
        {:else if listView}<ListView id={Number(listView.id)} />
        {:else if router.path === '/stats'}<Stats />
        {:else if router.path === '/wrapup'}<Wrapup />
        {:else if router.path === '/settings'}<Settings />
        {:else if router.path === '/privacy'}<Privacy />
        {:else if router.path === '/admin' && session.me.isAdmin}<Admin />
        {:else if invite}
          <div class="empty"><h2>{t('app.alreadyIn')}</h2><p>{t('app.passInvite')}</p><a class="btn" href="/">{t('app.toShelf')}</a></div>
        {:else}
          <div class="empty"><h2>{t('app.notFound')}</h2><a class="btn" href="/">{t('app.toShelf')}</a></div>
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
  .offbar { position: sticky; top: 0; z-index: 30; padding: 0.45rem 1rem; text-align: center; font-size: 0.85rem; background: var(--star); color: #1a1408; }
  .offbar a { color: inherit; text-decoration: underline; font-weight: 600; }
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
