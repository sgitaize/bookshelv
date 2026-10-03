<script lang="ts">
  import { api, percent, ago, fmtRating, type Home, type ReadingItem, type RecentReview, type Loans } from '../lib/api.ts';
  import Stars from '../components/Stars.svelte';
  import FeedList from '../components/FeedList.svelte';
  import type { FeedItem } from '../lib/api.ts';
  import { t, tn, i18n, fmtDate } from '../lib/i18n.svelte.ts';
  import { session, toastError } from '../lib/state.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';
  import { pending } from '../lib/offline.svelte.ts';
  import ProgressSheet from '../components/ProgressSheet.svelte';

  let home = $state<Home | null>(null);
  let editing = $state<ReadingItem | null>(null);

  let feed = $state<FeedItem[]>([]);
  let loans = $state<Loans | null>(null);
  const load = () => Promise.all([
    api.get<Home>('/home').then(r => (home = r)),
    api.get<Loans>('/loans').then(r => (loans = r)),
    api.get<{ items: FeedItem[] }>('/feed?limit=6').then(r => (feed = r.items))
  ]).catch(toastError);
  $effect(() => { load(); });

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 11 ? 'home.morning' : h < 18 ? 'home.hello' : 'home.evening';
  })();
</script>

{#if !home}
  <div class="spinner"></div>
{:else}
  <section class="hello">
    <h1>{t(greeting as 'home.hello')}, {session.me?.displayName}</h1>
    {#if pending.items.length}<a class="card pendinghint" href="/add"><Icon name="scan" size={18} /> {t('offline.homeHint', { n: pending.items.length })}</a>{/if}
    <div class="stats">
      <a href="/library"><b>{home.counts.books}</b><span>{t('home.onShelf')}</span></a>
      <span class="div"></span>
      <a href="/stats"><b>{home.counts.readThisYear}</b><span>{t('home.readYear', { year: new Date().getFullYear() })}</span></a>
      <span class="div"></span>
      <a href="/library?filter=unread"><b>{home.toReadCount}</b><span>{t('home.unread')}</span></a>
    </div>
  </section>

  {#if home.counts.books === 0 && !home.reading.length}
    <div class="empty card">
      <h2>{t('home.welcome')}</h2>
      <p>{t('home.welcomeText')}</p>
      <a href="/add" class="btn primary"><Icon name="scan" size={18} /> {t('shelf.addFirst')}</a>
    </div>
  {/if}

  {#if home.reading.length}
    <section class="current">
      <h2 class="center-title">{t('home.reading', { n: home.reading.length })}</h2>
      <div class="book-row centered">
        {#each home.reading as r (r.book.id)}
          {@const pct = percent(r.progress, r.book.pages)}
          <div class="reading">
            <a href="/book/{r.book.id}"><Cover url={r.book.coverUrl} title={r.book.title} authors={r.book.authors} /></a>
            <div class="prog">
              <button class="bar" onclick={() => (editing = r)} aria-label={t('progress.enter')}>
                <span class="fill" style="width: {Math.max(pct, 4)}%"></span>
                <span class="pct">{pct}%</span>
              </button>
              <button class="icon ghost pen" onclick={() => (editing = r)} aria-label={t('progress.edit')}><Icon name="edit" size={16} /></button>
            </div>
          </div>
        {/each}
      </div>
    </section>
    <hr class="sep" />
  {/if}

  {#if loans?.lent.some(l => l.overdue)}
    <a class="card overdue" href="/loans">⚠ {t('loan.overdueHome', { n: loans.lent.filter(l => l.overdue).length })}</a>
  {/if}

  {#if loans?.borrowed.length}
    <section>
      <div class="section-head">
        <h2>{t('loan.borrowedHome')}</h2>
        <a href="/loans?tab=borrowed" aria-label={t('loan.all')}><Icon name="arrow" /></a>
      </div>
      <div class="book-row">
        {#each loans.borrowed as l (l.id)}
          <a href={l.book.id ? `/book/${l.book.id}` : '/loans?tab=borrowed'} class="borrowed">
            <Cover url={l.book.coverUrl} title={l.book.title} authors={l.book.authors} />
            <span class="from" class:late={l.overdue}>{t('loan.from', { name: l.lender.displayName })}</span>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  {#if home.toRead.length}
    <section>
      <div class="section-head">
        <h2>{t('home.toRead', { n: home.toReadCount })}</h2>
        <a href="/library?filter=unread" aria-label={t('home.allUnread')}><Icon name="arrow" /></a>
      </div>
      <div class="book-row">
        {#each home.toRead as it (it.id)}
          <a href="/book/{it.book.id}"><Cover url={it.book.coverUrl} title={it.book.title} authors={it.book.authors} /></a>
        {/each}
      </div>
    </section>
  {/if}

  {#if home.recentlyRead.length}
    <section>
      <div class="section-head">
        <h2>{t('home.recentlyRead')}</h2>
        <a href="/library?filter=read" aria-label={t('home.allRead')}><Icon name="arrow" /></a>
      </div>
      <div class="book-row">
        {#each home.recentlyRead as r (r.book.id)}
          <a href="/book/{r.book.id}"><Cover url={r.book.coverUrl} title={r.book.title} authors={r.book.authors} /></a>
        {/each}
      </div>
    </section>
  {/if}

  {#if feed.length}
    <section>
      <div class="section-head">
        <h2>{t('feed.title')}</h2>
        <a href="/feed" aria-label={t('feed.all')}><Icon name="arrow" /></a>
      </div>
      <FeedList items={feed} />
    </section>
  {/if}

  {#if home.recentlyAdded.length}
    <section>
      <div class="section-head">
        <h2>{t('home.newOnShelf')}</h2>
        <a href="/library" aria-label={t('home.wholeLibrary')}><Icon name="arrow" /></a>
      </div>
      <div class="book-row">
        {#each home.recentlyAdded as it (it.id)}
          <a href="/book/{it.book.id}"><Cover url={it.book.coverUrl} title={it.book.title} authors={it.book.authors} /></a>
        {/each}
      </div>
    </section>
  {/if}
{/if}

<ProgressSheet item={editing} onclose={() => (editing = null)} onsaved={load} />

<style>
  .hello { text-align: center; padding: 0.6rem 0 1.4rem; }
  .hello h1 { font-size: 1.35rem; margin-bottom: 1rem; }
  .stats {
    display: flex; align-items: center; justify-content: space-around;
    border: 1px solid var(--line); border-radius: 8px; padding: 0.9rem 0.5rem; max-width: 460px; margin: 0 auto;
  }
  .stats a { display: grid; justify-items: center; color: var(--text); flex: 1; }
  .stats a:hover { text-decoration: none; }
  .stats b { font-size: 1.3rem; font-weight: 600; color: var(--accent); }
  .stats span { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .stats .div { width: 1px; align-self: stretch; background: var(--line); flex: none; }
  .center-title { text-align: center; color: var(--accent); margin-bottom: 1rem; }
  .book-row.centered { justify-content: safe center; }
  .reading { display: grid; gap: 0.5rem; flex-basis: 104px !important; }
  .prog { display: flex; align-items: center; gap: 0.2rem; }
  .bar {
    position: relative; flex: 1; height: 22px; padding: 0; border: none; border-radius: 6px;
    background: var(--surface-3); overflow: hidden; display: block;
  }
  .fill { position: absolute; inset: 0 auto 0 0; background: var(--progress); border-radius: 6px; }
  .pct { position: relative; font-size: 0.72rem; font-weight: 600; color: var(--text); padding-left: 6px; line-height: 22px; display: block; text-align: left; }
  .pen { padding: 0.25rem; color: var(--muted); }
  section { margin-bottom: 1.6rem; }
  .overdue { display: block; margin-bottom: 1.4rem; color: var(--danger); font-weight: 600; border-color: color-mix(in srgb, var(--danger) 50%, transparent); }
  .overdue:hover { text-decoration: none; }
  .borrowed { display: grid; gap: 0.35rem; color: var(--text); }
  .borrowed:hover { text-decoration: none; }
  .from { font-size: 0.75rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .from.late { color: var(--danger); font-weight: 600; }
  .pendinghint { display: flex; gap: 0.5rem; align-items: center; padding: 0.7rem 1rem; margin: 0 0 1rem; color: var(--text); border-color: var(--accent); }
</style>
