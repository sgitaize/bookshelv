<script lang="ts">
  // Booky-Import: je Liste festlegen, ob die Bücher im Regal stehen (alle oder einzeln angetippt),
  // auf die Wunschliste kommen, als Leseliste übernommen werden und welchen Lesestand sie bekommen.
  import { t, type Key } from '../lib/i18n.svelte.ts';
  import { bookyRowId, type BookyPlan, type BookyRow, type BookyTarget, type ImportItem } from '../lib/importers.ts';
  import Icon from './Icon.svelte';

  let { rows, items, plans = $bindable() }: { rows: BookyRow[]; items: ImportItem[]; plans: Record<string, BookyPlan> } = $props();

  const TARGETS: BookyTarget[] = ['all', 'pick', 'wish', 'none'];
  const STATUSES = ['auto', 'unread', 'reading', 'read', 'dnf'] as const;
  let openId = $state<string | null>(null);
  let filter = $state('');

  const label = (r: BookyRow) => (r.std ? t(`bp.std.${r.std}` as Key) : r.name);
  const booksOf = (r: BookyRow) => items.filter(it => it.booky?.refs.some(x => bookyRowId(x) === r.id));
  const shown = $derived.by(() => {
    const row = rows.find(r => r.id === openId);
    if (!row) return [];
    const q = filter.trim().toLowerCase();
    const all = booksOf(row);
    return q ? all.filter(it => `${it.title} ${(it.authors ?? []).join(' ')}`.toLowerCase().includes(q)) : all;
  });

  function setTarget(r: BookyRow, target: BookyTarget) {
    const p = plans[r.id];
    // von „alle im Regal“ auf „einzeln“: alle bleiben angetippt, man nimmt nur heraus
    if (target === 'pick' && p.target === 'all') p.picked = booksOf(r).map(it => it.booky!.key);
    p.target = target;
    if (target !== 'pick' && openId === r.id) openId = null;
  }
  function toggle(p: BookyPlan, key: string) {
    p.picked = p.picked.includes(key) ? p.picked.filter(k => k !== key) : [...p.picked, key];
  }
  function toggleOpen(id: string) { openId = openId === id ? null : id; filter = ''; }
</script>

<div class="planner">
  <span class="lbl">{t('bp.title')}</span>
  <span class="muted small">{t('bp.info')}</span>
  {#each rows as r (r.id)}
    {@const p = plans[r.id]}
    {#if p}
      <div class="row-card">
        <div class="head"><strong>{label(r)}</strong> <span class="muted small">{t('bp.books', { n: r.count })}</span></div>
        <div class="segmented targets">
          {#each TARGETS as tg}
            <button class:active={p.target === tg} onclick={() => setTarget(r, tg)}>{t(`bp.${tg}` as Key)}</button>
          {/each}
        </div>
        {#if p.target === 'all' || p.target === 'pick'}
          <div class="segmented">
            <button class:active={p.format === 'print'} onclick={() => (p.format = 'print')}>{t('format.print')}</button>
            <button class:active={p.format === 'ebook'} onclick={() => (p.format = 'ebook')}>{t('format.ebook')}</button>
          </div>
        {/if}
        {#if p.target === 'pick'}
          <div class="pickbar">
            <span class="small">{t('bp.picked', { n: p.picked.length, m: r.count })}</span>
            <button class="btn small" onclick={() => toggleOpen(r.id)}>{openId === r.id ? t('bp.hidePick') : t('bp.showPick')}</button>
          </div>
          {#if openId === r.id}
            <div class="picker">
              <div class="pickbar">
                <button class="btn small" onclick={() => (p.picked = booksOf(r).map(it => it.booky!.key))}>{t('bp.pickAll')}</button>
                <button class="btn small" onclick={() => (p.picked = [])}>{t('bp.pickNone')}</button>
                {#if r.count > 20}<input class="filter" type="search" bind:value={filter} placeholder={t('bp.filter')} />{/if}
              </div>
              <ul>
                {#each shown as it (it.booky!.key)}
                  {@const on = p.picked.includes(it.booky!.key)}
                  <li>
                    <button class="book" class:on aria-pressed={on} onclick={() => toggle(p, it.booky!.key)}>
                      <span class="box">{#if on}<Icon name="check" size={16} />{/if}</span>
                      <span class="bt"><span class="title">{it.title}</span>
                        <span class="muted small">{(it.authors ?? []).join(', ')}{#if it.status === 'read'}{' · '}{t('bp.read')}{/if}</span></span>
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        {/if}
        {#if !r.std || r.std === 'want_to_read'}
          <label class="row check"><input type="checkbox" bind:checked={p.list} /> {t('bp.asList')}</label>
          {#if p.list}<label class="field"><span>{t('bp.listName')}</span><input bind:value={p.name} maxlength="80" /></label>{/if}
          <label class="field"><span>{t('bp.status')}</span>
            <select bind:value={p.status}>
              {#each STATUSES as st}<option value={st}>{st === 'auto' ? t('bp.statusAuto') : t(`read.${st}` as Key)}</option>{/each}
            </select>
          </label>
        {/if}
      </div>
    {/if}
  {/each}
  <span class="muted small">{t('bp.rules')}</span>
</div>

<style>
  .planner { display: grid; gap: 0.6rem; }
  .lbl { font-size: 0.85rem; color: var(--muted); }
  .row-card { display: grid; gap: 0.5rem; justify-items: start; padding: 0.75rem; border: 1px solid var(--line); border-radius: 12px; min-width: 0; }
  .head { overflow-wrap: anywhere; }
  .targets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-radius: 16px; width: 100%; max-width: 26rem; }
  .targets button { white-space: normal; }
  .pickbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .picker { display: grid; gap: 0.5rem; width: 100%; }
  .filter { flex: 1; min-width: 10rem; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; max-height: 60vh; overflow-y: auto; overscroll-behavior: contain; }
  .book {
    display: flex; gap: 0.7rem; align-items: center; justify-content: flex-start; width: 100%; text-align: left; white-space: normal;
    padding: 0.55rem 0.6rem; border: none; border-radius: 10px; background: var(--surface-2); color: var(--text); min-height: 48px;
  }
  .book.on { background: var(--accent-soft); }
  .box { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; border: 2px solid var(--line); }
  .book.on .box { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .bt { display: grid; min-width: 0; }
  .title { overflow-wrap: anywhere; font-weight: 500; }
  .field { display: grid; gap: 0.25rem; width: 100%; }
  .field span { font-size: 0.85rem; color: var(--muted); }
</style>
