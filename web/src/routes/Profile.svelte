<script lang="ts">
  import { api, type Profile, type FeedItem, type ReadingListSummary } from '../lib/api.ts';
  import TopSheet from '../components/TopSheet.svelte';
  import FeedList from '../components/FeedList.svelte';
  import ListCard from '../components/ListCard.svelte';
  import { session, toastError } from '../lib/state.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';
  import Avatar from '../components/Avatar.svelte';
  import { t, tn, i18n, fmtDate } from '../lib/i18n.svelte.ts';

  // ohne userId: eigenes Profil
  let { userId }: { userId?: number } = $props();

  let p = $state<Profile | null>(null);
  let lists = $state<ReadingListSummary[]>([]);
  let activity = $state<FeedItem[]>([]);
  let topOpen = $state(false);
  const own = $derived(!userId || userId === session.me?.id);

  $effect(() => {
    p = null;
    const id = userId ?? session.me!.id;
    api.get<Profile>(`/users/${id}/profile`).then(r => (p = r)).catch(toastError);
    api.get<ReadingListSummary[]>(`/users/${id}/lists`).then(r => (lists = r)).catch(() => {});
    api.get<{ items: FeedItem[] }>(`/feed?user=${id}&limit=5`).then(r => (activity = r.items)).catch(() => {});
  });
</script>

{#if !p}
  <div class="spinner"></div>
{:else}
  <section class="profile">
    <div class="bigav"><Avatar name={p.displayName} url={p.avatarUrl} size={88} /></div>
    <h1>@{p.username}</h1>
    {#if p.displayName !== p.username}<p class="muted name">{p.displayName}</p>{/if}
    <!-- Top 5 als Untertitel, jeder Titel verlinkt -->
    {#if p.top.length}
      <p class="top">
        <span class="toplbl">{t('top.label')}</span>
        {#each p.top as b, i (b.id)}{#if i}<span class="dot" aria-hidden="true">·</span>{/if}<a href="/book/{b.id}">{b.title}</a>{/each}
        {#if own}<button class="icon ghost tiny" onclick={() => (topOpen = true)} aria-label={t('top.edit')}><Icon name="edit" size={14} /></button>{/if}
      </p>
    {:else if own}
      <button class="ghost small topadd" onclick={() => (topOpen = true)}><Icon name="star" size={14} /> {t('top.add')}</button>
    {/if}

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
      {#if lists.length || own}
        <div class="section-head"><h2>{t('list.title')}</h2>{#if own}<a href="/lists" aria-label={t('list.all')}><Icon name="arrow" /></a>{/if}</div>
        {#if lists.length}
          <div class="lists">{#each lists.slice(0, 6) as l (l.id)}<ListCard list={l} />{/each}</div>
        {:else}
          <p class="muted small">{t('list.hint')}</p>
        {/if}
      {/if}

      {#if activity.length}
        <div class="section-head"><h2>{t('feed.recent')}</h2><a href={`/feed?user=${p.id}`} aria-label={t('feed.all')}><Icon name="arrow" /></a></div>
        <div class="act"><FeedList items={activity} /></div>
      {/if}
    {:else}
      <p class="muted">{t('profile.private')}</p>
    {/if}

    <div class="row actions">
      {#if own}
        <a class="btn dark" href="/library"><Icon name="library" size={16} /> {t('shelf.mine')}</a>
        <a class="btn" href="/stats"><Icon name="chart" size={16} /> {t('stats.title')}</a>
        <a class="btn" href="/lists"><Icon name="list" size={16} /> {t('list.title')}</a>
        <a class="btn" href="/loans"><Icon name="users" size={16} /> {t('loan.title')}</a>
        <a class="btn" href="/reads"><Icon name="message" size={16} /> {t('reads.title')}</a>
        <a class="btn" href="/series"><Icon name="library" size={16} /> {t('series.mine')}</a>
        <a class="btn" href="/authors"><Icon name="bell" size={16} /> {t('authors.title')}</a>
        <a class="btn" href="/history"><Icon name="book" size={16} /> {t('hist.title')}</a>
        <a class="btn" href="/wishlist"><Icon name="bookmark" size={16} /> {t('wish.count', { n: p.wishlistCount })}</a>
        <a class="btn" href="/settings"><Icon name="settings" size={16} /> {t('settings.title')}</a>
        {#if session.me?.isAdmin}<a class="btn" href="/admin"><Icon name="shield" size={16} /> Admin</a>{/if}
      {:else if p.shelfVisible}
        <a class="btn dark" href="/people/{p.id}/shelf"><Icon name="library" size={16} /> {t('profile.toShelf')}</a>
        {#if p.wishlistCount}<a class="btn" href="/people/{p.id}/wishlist"><Icon name="bookmark" size={16} /> {t('wish.count', { n: p.wishlistCount })}</a>{/if}
      {/if}
    </div>
  </section>
  <TopSheet open={topOpen} current={p.top} onclose={() => (topOpen = false)} onsaved={top => { p!.top = top; topOpen = false; }} />
{/if}

<style>
  .profile { display: grid; justify-items: center; text-align: center; max-width: 560px; margin: 0 auto; }
  .bigav { margin: 0.8rem 0; }
  h1 { color: var(--accent); font-size: 1.4rem; margin: 0; }
  .name { margin: 0.1rem 0 0; }
  .top { margin: 0.5rem 0 0; font-size: 0.9rem; line-height: 1.5; color: var(--muted); max-width: 100%; overflow-wrap: anywhere; }
  .top a { color: var(--text); font-weight: 550; }
  .toplbl { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-right: 0.35rem; font-weight: 600; }
  .dot { margin: 0 0.35rem; }
  .tiny { width: 26px; height: 26px; min-height: 0; padding: 0; vertical-align: middle; }
  .topadd { margin-top: 0.4rem; }
  .lists { width: 100%; display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); text-align: left; margin-bottom: 1.4rem; }
  .act { width: 100%; text-align: left; }
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
