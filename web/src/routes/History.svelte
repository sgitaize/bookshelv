<script lang="ts">
  import { api, HISTORY_TYPES, LOAN_TYPES, type HistoryEvent, type HistoryType } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, type Key } from '../lib/i18n.svelte.ts';
  import Timeline from '../components/Timeline.svelte';
  import Icon from '../components/Icon.svelte';

  type Range = 'all' | '30' | 'year' | 'custom' | `y${string}`;
  const initialTypes = (router.query.get('types') ?? '').split(',').filter(x => HISTORY_TYPES.includes(x as HistoryType)) as HistoryType[];

  let types = $state<HistoryType[]>(initialTypes);
  let range = $state<Range>('all');
  let from = $state('');
  let to = $state('');
  let q = $state('');
  let events = $state<HistoryEvent[] | null>(null);
  let years = $state<string[]>([]);
  let timer: ReturnType<typeof setTimeout>;

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // Zeitraum-Auswahl → konkrete Daten
  const period = $derived.by(() => {
    const now = new Date();
    if (range === '30') return { from: iso(new Date(now.getTime() - 30 * 86400_000)), to: '' };
    if (range === 'year') return { from: `${now.getFullYear()}-01-01`, to: '' };
    if (range.startsWith('y')) return { from: `${range.slice(1)}-01-01`, to: `${range.slice(1)}-12-31` };
    if (range === 'custom') return { from, to };
    return { from: '', to: '' };
  });

  $effect(() => {
    const params = new URLSearchParams();
    if (period.from) params.set('from', period.from);
    if (period.to) params.set('to', period.to);
    if (types.length) params.set('types', types.join(','));
    if (q.trim()) params.set('q', q.trim());
    clearTimeout(timer);
    timer = setTimeout(() => {
      api.get<{ events: HistoryEvent[]; years: string[] }>(`/history?${params}`)
        .then(r => { events = r.events; years = r.years; })
        .catch(toastError);
    }, q ? 300 : 0);
  });

  function toggle(tp: HistoryType) {
    types = types.includes(tp) ? types.filter(x => x !== tp) : [...types, tp];
  }

  const loansOnly = $derived(types.length === LOAN_TYPES.length && LOAN_TYPES.every(x => types.includes(x)));
  const filtered = $derived(types.length > 0 || range !== 'all' || q.trim() !== '');

  function reset() { types = []; range = 'all'; q = ''; from = ''; to = ''; }
</script>

<section class="stack">
  <div class="spread">
    <h1>{t('hist.title')}</h1>
    {#if events}<span class="muted">{t('hist.summary', { n: events.length })}</span>{/if}
  </div>

  <div class="filters">
    <div class="row">
      <div class="searchbox grow">
        <Icon name="search" size={18} />
        <input bind:value={q} type="search" placeholder={t('hist.search')} />
      </div>
      <select bind:value={range} aria-label={t('hist.title')}>
        <option value="all">{t('hist.range.all')}</option>
        <option value="30">{t('hist.range.30')}</option>
        <option value="year">{t('hist.range.year')}</option>
        {#each years as y}<option value={`y${y}`}>{y}</option>{/each}
        <option value="custom">{t('hist.range.custom')}</option>
      </select>
    </div>
    {#if range === 'custom'}
      <div class="row dates">
        <label class="field"><span>{t('hist.from')}</span><input type="date" bind:value={from} max={to || undefined} /></label>
        <label class="field"><span>{t('hist.to')}</span><input type="date" bind:value={to} min={from || undefined} /></label>
      </div>
    {/if}
    <div class="chips">
      <button class:active={!types.length} onclick={() => (types = [])}>{t('hist.allTypes')}</button>
      <button class:active={loansOnly} onclick={() => (types = loansOnly ? [] : [...LOAN_TYPES])}>{t('hist.loansOnly')}</button>
      {#each HISTORY_TYPES as tp}
        <button class:active={types.includes(tp) && !loansOnly} onclick={() => toggle(tp)}>{t(`hist.t.${tp}` as Key)}</button>
      {/each}
    </div>
  </div>

  {#if events === null}
    <div class="spinner"></div>
  {:else if !events.length}
    <div class="empty">
      <p>{t('hist.none')}</p>
      {#if filtered}<button onclick={reset}>{t('hist.reset')}</button>{/if}
    </div>
  {:else}
    <Timeline {events} />
  {/if}
</section>

<style>
  section { max-width: 820px; margin: 0 auto; }
  .filters { display: grid; gap: 0.7rem; }
  .row { flex-wrap: nowrap; }
  .grow { flex: 1; min-width: 0; }
  select { width: auto; max-width: 45%; }
  .searchbox { position: relative; display: flex; align-items: center; }
  .searchbox :global(svg) { position: absolute; left: 0.8rem; color: var(--muted); pointer-events: none; }
  .searchbox input { padding-left: 2.4rem; }
  .dates { gap: 0.7rem; }
  .dates .field { flex: 1; min-width: 0; }
  .chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .chips button { font-size: 0.82rem; padding: 0.35em 0.85em; border-radius: 999px; }
  .chips button.active { background: var(--accent); color: var(--accent-ink); }
</style>
