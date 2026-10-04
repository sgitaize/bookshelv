<script lang="ts">
  // Autor*innen, denen ich folge, mit Neuerscheinungen (DNB) + Vorschläge aus dem eigenen Lesen
  import { api, type AuthorsPage } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t, fmtDate } from '../lib/i18n.svelte.ts';
  import { loadFollowed } from '../components/FollowAuthors.svelte';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';

  let data = $state<AuthorsPage | null>(null);
  let name = $state('');
  const load = () => api.get<AuthorsPage>('/authors').then(r => (data = r)).catch(toastError);
  $effect(() => { load(); });

  async function follow(n: string) {
    if (!n.trim()) return;
    try { await api.post('/authors/follow', { name: n.trim() }); name = ''; await Promise.all([load(), loadFollowed()]); } catch (e) { toastError(e); }
  }
  async function unfollow(n: string) {
    try { await api.post('/authors/unfollow', { name: n }); await Promise.all([load(), loadFollowed()]); } catch (e) { toastError(e); }
  }
  const releaseHref = (r: { bookId: number | null; isbn13: string | null; title: string }) =>
    r.bookId ? `/book/${r.bookId}` : `/add?tab=search&q=${encodeURIComponent(r.isbn13 ?? r.title)}`;
</script>

<section class="stack">
  <h1>{t('authors.title')}</h1>
  <p class="muted">{t('authors.intro')}</p>
  <form class="row add" onsubmit={e => { e.preventDefault(); follow(name); }}>
    <input bind:value={name} maxlength="120" placeholder={t('authors.namePh')} aria-label={t('authors.namePh')} class="grow" />
    <button class="primary" disabled={!name.trim()}><Icon name="plus" size={16} /> {t('authors.follow')}</button>
  </form>

  {#if !data}
    <div class="spinner"></div>
  {:else}
    {#if data.suggestions.length}
      <div class="sugg">
        <span class="muted small">{t('authors.suggestions')}</span>
        {#each data.suggestions as s (s.name)}
          <button class="chip small" onclick={() => follow(s.name)}><Icon name="plus" size={12} /> {s.name} <span class="muted">({s.n})</span></button>
        {/each}
      </div>
    {/if}

    {#if !data.follows.length}
      <p class="empty">{t('authors.none')}</p>
    {:else}
      {#each data.follows as f (f.name)}
        <article class="card author">
          <div class="ahead">
            <h2>{f.name}</h2>
            <button class="ghost small" onclick={() => unfollow(f.name)}>{t('authors.unfollow')}</button>
          </div>
          {#if !f.checkedAt}
            <p class="muted small">{t('authors.checking')}</p>
          {:else if !f.releases.length}
            <p class="muted small">{t('authors.noReleases', { d: fmtDate(f.checkedAt) })}</p>
          {:else}
            <div class="rels">
              {#each f.releases as r (r.id)}
                <a class="rel" href={releaseHref(r)}>
                  <Cover url={r.coverUrl} title={r.title} authors={[f.name]} />
                  <span class="rt">{r.title}</span>
                  <span class="muted small">{r.upcoming ? t('authors.upcoming', { y: r.year }) : r.year}{#if r.bookId}{' · '}{t('authors.inLibrary')}{/if}</span>
                </a>
              {/each}
            </div>
          {/if}
        </article>
      {/each}
    {/if}
  {/if}
</section>

<style>
  .add { gap: 0.5rem; }
  .grow { flex: 1; min-width: 0; }
  .sugg { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
  .sugg .chip { display: inline-flex; align-items: center; gap: 0.25rem; cursor: pointer; }
  .author { padding: 0.9rem; display: grid; gap: 0.6rem; }
  .ahead { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; }
  .ahead h2 { margin: 0; font-size: 1.15rem; overflow-wrap: anywhere; min-width: 0; }
  .rels { display: grid; grid-auto-flow: column; grid-auto-columns: 100px; gap: 0.7rem; overflow-x: auto; padding-bottom: 0.3rem; scrollbar-width: thin; }
  .rel { display: grid; gap: 0.25rem; color: var(--text); align-content: start; }
  .rel:hover { text-decoration: none; }
  .rt { font-size: 0.82rem; font-weight: 600; line-height: 1.25; overflow-wrap: anywhere; }
</style>
