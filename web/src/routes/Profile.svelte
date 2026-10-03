<script lang="ts">
  import { api, type Profile } from '../lib/api.ts';
  import { session, toastError } from '../lib/state.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';
  import { t, tn, i18n, fmtDate } from '../lib/i18n.svelte.ts';

  // ohne userId: eigenes Profil
  let { userId }: { userId?: number } = $props();

  let p = $state<Profile | null>(null);
  const own = $derived(!userId || userId === session.me?.id);

  $effect(() => {
    p = null;
    api.get<Profile>(`/users/${userId ?? session.me!.id}/profile`).then(r => (p = r)).catch(toastError);
  });
</script>

{#if !p}
  <div class="spinner"></div>
{:else}
  <section class="profile">
    <div class="avatar" style="--h: {(p.id * 67) % 360}">{p.displayName.slice(0, 1).toUpperCase()}</div>
    <h1>@{p.username}</h1>
    {#if p.displayName !== p.username}<p class="muted name">{p.displayName}</p>{/if}

    <div class="stats">
      <a href={own ? '/library' : `/people/${p.id}/shelf`}><b>{p.counts.books}</b><span>{t('profile.books')}</span></a>
      <span class="div"></span>
      <div><b>{p.counts.read}</b><span>{t('profile.read')}</span></div>
      <span class="div"></span>
      <div><b>{p.counts.readThisYear}</b><span>{t('profile.thisYear')}</span></div>
      <span class="div"></span>
      <div><b>{p.averageRating ? p.averageRating.toLocaleString(i18n.locale, { maximumFractionDigits: 1 }) : '–'}</b><span>{t('profile.avgStars')}</span></div>
    </div>

    {#if p.shelfVisible}
      <div class="favs">
        <h2><span class="star">★</span> {t('filter.favorites')} <span class="star">★</span></h2>
        {#if p.favorites.length}
          <div class="shelf">
            {#each p.favorites.slice(0, 5) as b (b.id)}
              <a href="/book/{b.id}"><Cover url={b.coverUrl} title={b.title} authors={b.authors} /></a>
            {/each}
          </div>
          <div class="board"></div>
        {:else}
          <p class="muted small">{own ? t('profile.favHint') : t('profile.noFavs')}</p>
        {/if}
      </div>

      {#if p.reading.length}
        <div class="section-head"><h2>{t('profile.reading')}</h2></div>
        <div class="book-row">
          {#each p.reading as b (b.id)}
            <a href="/book/{b.id}"><Cover url={b.coverUrl} title={b.title} authors={b.authors} /></a>
          {/each}
        </div>
      {/if}
    {:else}
      <p class="muted">{t('profile.private')}</p>
    {/if}

    <div class="row actions">
      {#if own}
        <a class="btn dark" href="/library"><Icon name="library" size={16} /> {t('shelf.mine')}</a>
        <a class="btn" href="/settings"><Icon name="settings" size={16} /> {t('settings.title')}</a>
        {#if session.me?.isAdmin}<a class="btn" href="/admin"><Icon name="shield" size={16} /> Admin</a>{/if}
      {:else if p.shelfVisible}
        <a class="btn dark" href="/people/{p.id}/shelf"><Icon name="library" size={16} /> {t('profile.toShelf')}</a>
      {/if}
    </div>
  </section>
{/if}

<style>
  .profile { display: grid; justify-items: center; text-align: center; max-width: 560px; margin: 0 auto; }
  .avatar {
    width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; margin: 0.8rem 0;
    font-weight: 600; font-size: 2.1rem; background: var(--accent); color: var(--accent-ink);
  }
  h1 { color: var(--accent); font-size: 1.4rem; margin: 0; }
  .name { margin: 0.1rem 0 0; }
  .stats {
    display: flex; align-items: center; width: 100%; margin: 1.3rem 0 2rem;
    border: 1px solid var(--line); border-radius: 8px; padding: 0.9rem 0.5rem;
  }
  .stats > a, .stats > div { display: grid; justify-items: center; flex: 1; color: var(--text); }
  .stats > a:hover { text-decoration: none; }
  .stats b { font-size: 1.3rem; font-weight: 600; color: var(--accent); }
  .stats span { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .stats .div { width: 1px; align-self: stretch; background: var(--line); flex: none; }
  .favs { width: 100%; margin-bottom: 1.8rem; }
  .favs h2 { color: #a0703a; }
  .star { color: var(--star); }
  /* Favoriten stehen auf einem Holzbrett */
  .shelf { display: flex; justify-content: center; gap: 0.7rem; align-items: flex-end; padding: 0 0.8rem; }
  .shelf a { width: 17%; max-width: 76px; }
  .board {
    height: 12px; margin: 0 -0.2rem; border-radius: 3px;
    background: linear-gradient(#5b4030, #3d2a1f);
    box-shadow: 0 4px 8px rgb(0 0 0 / 0.25);
  }
  .section-head { width: 100%; }
  .book-row { width: 100%; }
  .actions { justify-content: center; margin-top: 1rem; }
</style>
