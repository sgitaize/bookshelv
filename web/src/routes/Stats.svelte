<script lang="ts">
  import { api, type Stats } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, i18n, type Key } from '../lib/i18n.svelte.ts';
  import BarChart from '../components/BarChart.svelte';
  import HBarChart from '../components/HBarChart.svelte';
  import Icon from '../components/Icon.svelte';

  let year = $state<string | null>(router.query.get('year') ?? String(new Date().getFullYear()));
  let s = $state<Stats | null>(null);

  $effect(() => {
    api.get<Stats>(`/stats${year ? `?year=${year}` : ''}`).then(r => (s = r)).catch(toastError);
  });

  const nf = (n: number) => n.toLocaleString(i18n.locale);
  const monthName = (m: number, style: 'short' | 'long') => new Date(2000, m - 1, 1).toLocaleDateString(i18n.locale, { month: style });
  // aktuelles Jahr immer anbieten, auch wenn noch nichts gelesen
  const years = $derived([...new Set([String(new Date().getFullYear()), ...(s?.years ?? [])])].sort().reverse());
</script>

<section class="stack">
  <div class="spread">
    <h1>{t('stats.title')}</h1>
    {#if year && s?.totals.books}<a class="btn primary" href="/wrapup?year={year}"><Icon name="sparkle" size={16} /> {t('stats.wrapup', { y: year })}</a>{/if}
  </div>

  <div class="chips">
    {#each years as y}<button class:active={year === y} onclick={() => (year = y)}>{y}</button>{/each}
    <button class:active={year === null} onclick={() => (year = null)}>{t('stats.all')}</button>
  </div>

  {#if !s}
    <div class="spinner"></div>
  {:else}
    <div class="tiles">
      <div class="tile"><b>{nf(s.totals.books)}</b><span>{t('stats.books')}</span>{#if s.totals.dnf}<small>{t('stats.dnf', { n: s.totals.dnf })}</small>{/if}</div>
      <div class="tile"><b>{nf(s.totals.pages)}</b><span>{t('stats.pages')}</span></div>
      <div class="tile"><b>{s.totals.avgRating ? s.totals.avgRating.toLocaleString(i18n.locale, { maximumFractionDigits: 2 }) : '–'}</b><span>{t('stats.avgRating')}</span>
        <small>{s.totals.rated ? t('stats.ofRated', { n: s.totals.rated }) : t('stats.noRating')}</small></div>
      <div class="tile"><b>{s.totals.avgDays ?? '–'}</b><span>{t('stats.avgDays')}</span></div>
    </div>

    {#if !s.totals.books}
      <p class="empty">{t('stats.none')}</p>
    {:else}
      <div class="charts">
        {#if year}
          <div class="card">
            <h2>{t('stats.perMonth')}</h2>
            <BarChart label={t('stats.perMonth')} unit={t('stats.books.unit')}
              data={s.perMonth.map(m => ({ label: monthName(m.month, 'short').slice(0, 3), value: m.books, tip: monthName(m.month, 'long') }))} />
          </div>
          <div class="card">
            <h2>{t('stats.pagesPerMonth')}</h2>
            <BarChart label={t('stats.pagesPerMonth')}
              data={s.perMonth.map(m => ({ label: monthName(m.month, 'short').slice(0, 3), value: m.pages, tip: monthName(m.month, 'long') }))} />
          </div>
        {:else}
          <div class="card wide">
            <h2>{t('stats.perYear')}</h2>
            <BarChart label={t('stats.perYear')} unit={t('stats.books.unit')} data={s.perYear.map(y => ({ label: y.name, value: y.n }))} />
          </div>
        {/if}
        {#if s.totals.rated}
          <div class="card">
            <h2>{t('stats.ratings')}</h2>
            <BarChart label={t('stats.ratings')} data={s.ratings.map(r => ({ label: r.rating.toLocaleString(i18n.locale), value: r.n, tip: `${r.rating.toLocaleString(i18n.locale)} ★` }))} />
          </div>
        {/if}
        {#if s.genres.length}
          <div class="card"><h2>{t('stats.genres')}</h2><HBarChart label={t('stats.genres')} data={s.genres.map(g => ({ label: g.name, value: g.n }))} /></div>
        {/if}
        <div class="card"><h2>{t('stats.authors')}</h2><HBarChart label={t('stats.authors')} data={s.authors.map(a => ({ label: a.name, value: a.n }))} /></div>
        <div class="card"><h2>{t('stats.formats')}</h2><HBarChart label={t('stats.formats')} data={s.formats.map(f => ({ label: t(`stats.fmt.${f.name}` as Key), value: f.n }))} /></div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .chips button { font-size: 0.85rem; padding: 0.4em 0.9em; border-radius: 999px; }
  .chips button.active { background: var(--accent); color: var(--accent-ink); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.7rem; }
  .tile { display: grid; gap: 0.1rem; padding: 1rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
  .tile b { font-size: 1.8rem; font-weight: 600; color: var(--text); line-height: 1.1; }
  .tile span { color: var(--muted); font-size: 0.82rem; }
  .tile small { color: var(--muted); font-size: 0.75rem; }
  .charts { display: grid; gap: 0.9rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); }
  .charts h2 { font-size: 1rem; margin-bottom: 1.2rem; }
  .wide { grid-column: 1 / -1; }
</style>
