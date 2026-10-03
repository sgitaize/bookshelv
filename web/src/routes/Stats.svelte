<script lang="ts">
  import { api, type Stats, type StatGroup, type BookBrief } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, tn, i18n, type Key } from '../lib/i18n.svelte.ts';
  import BarChart from '../components/BarChart.svelte';
  import HBarChart from '../components/HBarChart.svelte';
  import MonthLine from '../components/MonthLine.svelte';
  import MoodLine from '../components/MoodLine.svelte';
  import BooksSheet from '../components/BooksSheet.svelte';
  import Icon from '../components/Icon.svelte';

  let year = $state<string | null>(router.query.get('year') ?? String(new Date().getFullYear()));
  let s = $state<Stats | null>(null);
  let pick = $state<{ title: string; books: BookBrief[] } | null>(null);

  $effect(() => {
    api.get<Stats>(`/stats${year ? `?year=${year}` : ''}`).then(r => (s = r)).catch(toastError);
  });

  const nf = (n: number) => n.toLocaleString(i18n.locale);
  const monthName = (m: number, style: 'short' | 'long') => new Date(2000, m - 1, 1).toLocaleDateString(i18n.locale, { month: style });
  // aktuelles Jahr immer anbieten, auch wenn noch nichts gelesen
  const years = $derived([...new Set([String(new Date().getFullYear()), ...(s?.years ?? [])])].sort().reverse());

  const langNames = $derived.by(() => { try { return new Intl.DisplayNames([i18n.locale], { type: 'language' }); } catch { return null; } });
  const langName = (code: string) => code === 'unknown' ? t('stats.unknown') : (langNames?.of(code) ?? code);
  const pct = (n: number, total: number) => total ? `${(Math.round((n / total) * 1000) / 10).toLocaleString(i18n.locale)} %` : '';
  /** Kurzfassung wie bei StoryGraph: „Deutsch: 95,6 %, Englisch: 4,4 %“ (die größten drei) */
  const summary = (g: StatGroup[], name: (x: StatGroup) => string) => {
    const total = g.reduce((a, x) => a + x.n, 0);
    return g.slice(0, 3).map(x => `${name(x)}: ${pct(x.n, total)}`).join(', ');
  };
  const show = (title: string, ids: number[]) => { if (ids.length && s) pick = { title, books: ids.map(id => s!.books[id]).filter(Boolean) }; };
  const bars = (g: StatGroup[], name: (x: StatGroup) => string) => {
    const total = g.reduce((a, x) => a + x.n, 0);
    return g.map(x => ({ label: name(x), value: x.n, pct: pct(x.n, total) }));
  };

  const fmtName = (x: StatGroup) => t(`stats.fmt.${x.name}` as Key);
  const pageName = (x: StatGroup) => x.name === 'unknown' ? t('stats.unknown') : t('stats.pagesBucket', { p: x.name });
  const moodName = (x: StatGroup) => t(`mood.${x.name}` as Key);
  const paceName = (x: StatGroup) => t(`pace.${x.name}` as Key);
  const plain = (x: StatGroup) => x.name;
  const pageGroups = $derived(s?.pageBuckets.filter(x => x.n) ?? []);
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
      <div class="tile"><b>{nf(s.totals.pages)}</b><span>{t('stats.pages')}</span>{#if s.totals.avgPages}<small>{t('stats.avgPages', { n: nf(s.totals.avgPages) })}</small>{/if}</div>
      <div class="tile"><b>{s.totals.avgRating ? s.totals.avgRating.toLocaleString(i18n.locale, { maximumFractionDigits: 2 }) : '–'}</b><span>{t('stats.avgRating')}</span>
        <small>{s.totals.rated ? t('stats.ofRated', { n: s.totals.rated }) : t('stats.noRating')}</small></div>
      <div class="tile"><b>{s.totals.avgDays ?? '–'}</b><span>{t('stats.avgDays')}</span></div>
    </div>

    {#if !s.totals.books}
      <p class="empty">{t('stats.none')}</p>
    {:else}
      <p class="muted small hint">{t('stats.tapHint')}</p>
      <div class="charts">
        {#if year}
          <div class="card wide">
            <h2>{t('stats.moodMap')}</h2>
            {#if s.totals.withMood}
              <p class="sub">{t('stats.moodMapSub')}</p>
              <MoodLine data={s.perMonth.map(m => ({ label: monthName(m.month, 'short').slice(0, 3), value: m.mood }))} />
            {:else}
              <p class="muted small">{t('stats.moodEmpty')}</p>
            {/if}
          </div>
          <div class="card wide">
            <h2>{t('stats.perMonthBoth')}</h2>
            <p class="sub"><strong>{tn('list.books', s.totals.books)}</strong>, {t('stats.pagesSum', { n: nf(s.totals.pages) })}</p>
            <MonthLine onpick={i => show(monthName(i + 1, 'long'), s!.perMonth[i].ids)}
              data={s.perMonth.map(m => ({ label: monthName(m.month, 'short').slice(0, 3), tip: monthName(m.month, 'long'), books: m.books, pages: m.pages }))} />
          </div>
        {:else}
          <div class="card wide">
            <h2>{t('stats.perYear')}</h2>
            <BarChart label={t('stats.perYear')} unit={t('stats.books.unit')} onpick={i => show(s!.perYear[i].name, s!.perYear[i].ids)}
              data={s.perYear.map(y => ({ label: y.name, value: y.n }))} />
          </div>
        {/if}
        {#if s.moods.length}
          <div class="card">
            <h2>{t('stats.moods')}</h2>
            <p class="sub">{summary(s.moods, moodName)}</p>
            <HBarChart label={t('stats.moods')} data={bars(s.moods, moodName)} onpick={i => show(moodName(s!.moods[i]), s!.moods[i].ids)} />
          </div>
        {/if}
        {#if s.paces.length}
          <div class="card">
            <h2>{t('stats.pace')}</h2>
            <p class="sub">{summary(s.paces, paceName)}</p>
            <HBarChart label={t('stats.pace')} data={bars(s.paces, paceName)} onpick={i => show(paceName(s!.paces[i]), s!.paces[i].ids)} />
          </div>
        {/if}
        {#if s.totals.rated}
          <div class="card">
            <h2>{t('stats.ratings')}</h2>
            <p class="sub">{t('stats.ratingsSub', { n: s.totals.rated, avg: s.totals.avgRating?.toLocaleString(i18n.locale, { maximumFractionDigits: 2 }) ?? '–' })}</p>
            <BarChart label={t('stats.ratings')} onpick={i => show(`${s!.ratings[i].rating.toLocaleString(i18n.locale)} ★`, s!.ratings[i].ids)}
              data={s.ratings.map(r => ({ label: r.rating.toLocaleString(i18n.locale), value: r.n, tip: `${r.rating.toLocaleString(i18n.locale)} ★` }))} />
          </div>
        {/if}
        <div class="card">
          <h2>{t('stats.pageCount')}</h2>
          <p class="sub">{summary(pageGroups, pageName)}</p>
          <HBarChart label={t('stats.pageCount')} data={bars(pageGroups, pageName)} onpick={i => show(pageName(pageGroups[i]), pageGroups[i].ids)} />
        </div>
        {#if s.genres.length}
          <div class="card">
            <h2>{t('stats.genres')}</h2>
            <HBarChart label={t('stats.genres')} data={bars(s.genres, plain).map(x => ({ ...x, pct: undefined }))} onpick={i => show(s!.genres[i].name, s!.genres[i].ids)} />
          </div>
        {/if}
        <div class="card">
          <h2>{t('stats.languages')}</h2>
          <p class="sub">{summary(s.languages, x => langName(x.name))}</p>
          <HBarChart label={t('stats.languages')} data={bars(s.languages, x => langName(x.name))} onpick={i => show(langName(s!.languages[i].name), s!.languages[i].ids)} />
        </div>
        <div class="card">
          <h2>{t('stats.formats')}</h2>
          <p class="sub">{summary(s.formats, fmtName)}</p>
          <HBarChart label={t('stats.formats')} data={bars(s.formats, fmtName)} onpick={i => show(fmtName(s!.formats[i]), s!.formats[i].ids)} />
        </div>
        <div class="card">
          <h2>{t('stats.authors')}</h2>
          <HBarChart label={t('stats.authors')} data={s.authors.map(a => ({ label: a.name, value: a.n }))} onpick={i => show(s!.authors[i].name, s!.authors[i].ids)} />
        </div>
      </div>
    {/if}
  {/if}
</section>

<BooksSheet {pick} onclose={() => (pick = null)} />

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
  .charts h2 { font-size: 1rem; margin-bottom: 0.3rem; }
  .sub { color: var(--muted); font-size: 0.82rem; margin: 0 0 1.1rem; }
  .charts h2:has(+ :not(.sub)) { margin-bottom: 1.2rem; }
  .hint { margin: 0; font-style: italic; }
  .wide { grid-column: 1 / -1; }
</style>
