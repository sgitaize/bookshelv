<script lang="ts">
  import Icon from './Icon.svelte';
  import { router } from '../lib/router.svelte.ts';

  const items = $derived([
    { href: '/', icon: 'home', label: 'Start', active: router.path === '/' },
    { href: '/library', icon: 'library', label: 'Bibliothek', active: router.path === '/library' },
    { href: '/add', icon: 'scan', label: 'Hinzufügen', active: router.path === '/add' },
    { href: '/people', icon: 'users', label: 'Freunde', active: router.path.startsWith('/people') },
    { href: '/me', icon: 'user', label: 'Profil', active: ['/me', '/settings', '/admin'].includes(router.path) }
  ]);

  let q = $state('');
  function search(e: SubmitEvent) {
    e.preventDefault();
    router.go(`/add?tab=search&q=${encodeURIComponent(q)}`);
    q = '';
  }
</script>

<header class="top">
  <a href="/" class="brand" aria-label="bookshelv – Start">
    <img src="/icon.svg" alt="" width="30" height="30" /><span>bookshelv</span>
  </a>
  <form class="search" onsubmit={search} role="search">
    <input bind:value={q} type="search" placeholder="Alle Bücher durchsuchen …" aria-label="Bücher suchen" />
    <a href="/add?tab=scan" class="scan" aria-label="ISBN scannen"><Icon name="scan" size={22} /></a>
  </form>
  <nav class="desktop">
    {#each items as it}
      <a href={it.href} class:active={it.active}><Icon name={it.icon} size={18} />{it.label}</a>
    {/each}
  </nav>
</header>

<nav class="tabbar" aria-label="Hauptnavigation">
  {#each items as it}
    <a href={it.href} class:active={it.active} aria-label={it.label}>
      <Icon name={it.icon} size={24} />
    </a>
  {/each}
</nav>

<style>
  .top {
    position: sticky; top: 0; z-index: 30;
    display: flex; align-items: center; gap: 1rem;
    padding: calc(0.7rem + env(safe-area-inset-top)) 1.2rem 0.7rem;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line);
  }
  .brand { display: none; align-items: center; gap: 0.5rem; font-weight: 600; font-size: 1.15rem; color: var(--text); }
  .brand img { border-radius: 8px; }
  .brand:hover { text-decoration: none; }
  .search { flex: 1; position: relative; display: flex; align-items: center; max-width: 520px; }
  .search input { padding-right: 3rem; border-radius: 10px; }
  .scan { position: absolute; right: 0.6rem; color: var(--text); display: grid; place-items: center; padding: 0.2rem; }
  .desktop { display: none; gap: 0.2rem; margin-left: auto; }
  .desktop a {
    display: flex; align-items: center; gap: 0.45em;
    padding: 0.5em 0.85em; border-radius: 999px; color: var(--muted); font-weight: 500; font-size: 0.92rem;
  }
  .desktop a:hover { color: var(--text); background: var(--surface-2); text-decoration: none; }
  .desktop a.active { color: var(--accent); background: var(--accent-soft); }

  /* schwebende Glas-Tabbar */
  .tabbar {
    position: fixed; z-index: 40;
    left: 16px; right: 16px; bottom: calc(10px + env(safe-area-inset-bottom));
    height: 62px;
    display: flex; justify-content: space-around; align-items: center;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--glass);
    backdrop-filter: blur(20px) saturate(1.6);
    -webkit-backdrop-filter: blur(20px) saturate(1.6);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.12);
  }
  .tabbar a {
    display: grid; place-items: center;
    width: 64px; height: 50px; border-radius: 999px;
    color: var(--text);
    transition: background 0.2s, color 0.2s;
  }
  .tabbar a:hover { text-decoration: none; }
  .tabbar a.active { background: color-mix(in srgb, var(--text) 9%, transparent); color: var(--accent); }

  @media (min-width: 760px) {
    .brand { display: flex; }
    .desktop { display: flex; }
    .tabbar { display: none; }
  }
</style>
