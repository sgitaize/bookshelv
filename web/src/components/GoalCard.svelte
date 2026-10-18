<script lang="ts">
  // Leseziel eines Jahres: Fortschrittsbalken für Bücher und/oder Seiten, Antippen bearbeitet (Startseite, Statistik)
  import { api, type Goal } from '../lib/api.ts';
  import { t, i18n } from '../lib/i18n.svelte.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';

  let { year, goal, compact = false, onchange }: { year: number; goal: Goal | null; compact?: boolean; onchange: (g: Goal | null) => void } = $props();

  let open = $state(false);
  let books = $state('');
  let pages = $state('');
  let busy = $state(false);
  const nf = (n: number) => n.toLocaleString(i18n.locale);
  const pct = (done: number, of: number) => Math.min(100, Math.round((done / of) * 100));

  function edit() {
    books = goal?.books?.toString() ?? '';
    pages = goal?.pages?.toString() ?? '';
    open = true;
  }
  async function save(e?: SubmitEvent, clear = false) {
    e?.preventDefault();
    busy = true;
    try {
      onchange(await api.put<Goal | null>(`/goals/${year}`, clear ? {} : { books: books || null, pages: pages || null }));
      open = false;
    } catch (err) { toastError(err); } finally { busy = false; }
  }

  /** Vorsprung/Rückstand gegenüber gleichmäßigem Lesen (nur im laufenden Jahr) */
  function pace(done: number, expected: number | null | undefined, of: number) {
    if (expected == null || done >= of) return done >= of ? t('goal.reached') : '';
    const d = Math.round(done - expected);
    return d > 0 ? t('goal.ahead', { n: nf(d) }) : d < 0 ? t('goal.behind', { n: nf(-d) }) : t('goal.onTrack');
  }
</script>

{#if goal}
  <button class="card goal" class:compact onclick={edit} aria-label={t('goal.edit')}>
    <span class="head"><b>{t('goal.title', { y: year })}</b><Icon name="edit" size={14} /></span>
    {#if goal.books}
      <span class="line"><span>{t('goal.booksOf', { n: nf(goal.done.books), of: nf(goal.books) })}</span><small>{pace(goal.done.books, goal.expected?.books, goal.books)}</small></span>
      <span class="bar"><span class="fill" style="width: {pct(goal.done.books, goal.books)}%"></span></span>
    {/if}
    {#if goal.pages}
      <span class="line"><span>{t('goal.pagesOf', { n: nf(goal.done.pages), of: nf(goal.pages) })}</span><small>{pace(goal.done.pages, goal.expected?.pages, goal.pages)}</small></span>
      <span class="bar"><span class="fill" style="width: {pct(goal.done.pages, goal.pages)}%"></span></span>
    {/if}
  </button>
{:else}
  <button class="ghost small setgoal" onclick={edit}><Icon name="plus" size={14} /> {t('goal.set', { y: year })}</button>
{/if}

<Sheet {open} onclose={() => (open = false)} title={t('goal.title', { y: year })}>
  <form class="stack" onsubmit={save}>
    <label class="field"><span>{t('goal.books')}</span><input type="number" inputmode="numeric" min="1" max="10000" bind:value={books} placeholder="24" /></label>
    <label class="field"><span>{t('goal.pages')}</span><input type="number" inputmode="numeric" min="1" max="10000000" bind:value={pages} placeholder="8000" /></label>
    <p class="muted small">{t('goal.info')}</p>
    <div class="row acts">
      {#if goal}<button type="button" class="ghost danger small" onclick={() => save(undefined, true)}>{t('goal.remove')}</button>{/if}
      <span class="grow"></span>
      <button class="primary" disabled={busy}>{t('common.save')}</button>
    </div>
  </form>
</Sheet>

<style>
  .goal { display: grid; gap: 0.35rem; width: 100%; max-width: 460px; margin: 0.8rem auto 0; padding: 0.8rem 1rem; text-align: left; color: var(--text); font: inherit; white-space: normal; }
  .goal.compact { margin: 0; max-width: none; }
  .head { display: flex; justify-content: space-between; align-items: center; color: var(--muted); }
  .head b { color: var(--text); font-weight: 600; }
  .line { display: flex; justify-content: space-between; gap: 0.6rem; font-size: 0.88rem; flex-wrap: wrap; }
  .line small { color: var(--muted); }
  .bar { height: 8px; border-radius: 4px; background: var(--surface-3); overflow: hidden; display: block; }
  .fill { display: block; height: 100%; background: var(--progress); border-radius: 4px; }
  .setgoal { margin: 0.6rem auto 0; color: var(--muted); }
  .acts { align-items: center; }
  .grow { flex: 1; }
</style>
