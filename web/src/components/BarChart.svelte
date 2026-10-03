<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';

  // Säulendiagramm, eine Reihe in der Akzentfarbe. Tooltip bei Hover/Antippen, Tabelle zum Aufklappen.
  let { data, unit = '', label }: { data: { label: string; value: number; tip?: string }[]; unit?: string; label: string } = $props();

  let active = $state<number | null>(null);
  const max = $derived(Math.max(1, ...data.map(d => d.value)));
  // „schöne“ Obergrenze für 3 Rasterlinien
  const top = $derived.by(() => {
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / step) * step;
  });
  // nur ganzzahlige Rasterlinien (es gibt keine halben Bücher)
  const ticks = $derived(top >= 2 && Number.isInteger(top / 2) ? [top, top / 2] : [top]);
  const empty = $derived(data.every(d => d.value === 0));
  const maxIdx = $derived(data.findIndex(d => d.value === max && max > 0));
</script>

<figure class="chart" aria-label={label}>
  {#if empty}<p class="nodata">{t('stats.noData')}</p>{:else}
  <div class="plot" role="group" aria-label={label} onmouseleave={() => (active = null)}>
    {#each ticks as tk}
      <div class="grid" style="bottom: {(tk / top) * 100}%"><span>{tk}</span></div>
    {/each}
    <div class="bars">
      {#each data as d, i}
        <button class="col" class:on={active === i}
          onmouseenter={() => (active = i)} onfocus={() => (active = i)} onclick={() => (active = active === i ? null : i)}
          aria-label="{d.label}: {d.value}{unit}">
          <span class="bar" style="height: {(d.value / top) * 100}%">
            {#if i === maxIdx && active === null}<span class="peak">{d.value}</span>{/if}
          </span>
          {#if active === i}
            <span class="tip" style="bottom: calc({(d.value / top) * 100}% + 8px)"><b>{d.value}{unit}</b> {d.tip ?? d.label}</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
  <div class="xaxis">{#each data as d}<span>{d.label}</span>{/each}</div>
  {/if}
  <details class="table">
    <summary>{t('stats.table')}</summary>
    <table><tbody>{#each data as d}<tr><th>{d.tip ?? d.label}</th><td>{d.value}{unit}</td></tr>{/each}</tbody></table>
  </details>
</figure>

<style>
  .chart { margin: 0; }
  .nodata { color: var(--muted); font-size: 0.85rem; margin: 0; }
  .plot { position: relative; height: 170px; margin-left: 1.6rem; }
  .grid { position: absolute; left: 0; right: 0; border-top: 1px solid var(--line); }
  .grid span { position: absolute; left: -1.6rem; top: -0.55rem; font-size: 0.68rem; color: var(--muted); width: 1.4rem; text-align: right; }
  .bars { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 2px; border-bottom: 1px solid var(--surface-3); }
  .col { flex: 1; height: 100%; display: flex; align-items: flex-end; justify-content: center; position: relative; padding: 0; border: none; background: none; border-radius: 0; min-width: 0; }
  .col:hover, .col:active { background: none; transform: none; }
  .bar { position: relative; width: min(70%, 28px); background: var(--accent); border-radius: 4px 4px 0 0; min-height: 0; transition: background 0.15s; }
  .col.on .bar { background: var(--accent-2); }
  .peak { position: absolute; top: -1.2rem; left: 50%; translate: -50% 0; font-size: 0.72rem; font-weight: 600; color: var(--text); }
  .tip {
    position: absolute; left: 50%; translate: -50% 0; z-index: 2; white-space: nowrap; pointer-events: none;
    background: var(--text); color: var(--bg); font-size: 0.75rem; padding: 0.25rem 0.5rem; border-radius: 6px;
  }
  .xaxis { display: flex; gap: 2px; margin-left: 1.6rem; margin-top: 0.3rem; }
  .xaxis span { flex: 1; text-align: center; font-size: 0.66rem; color: var(--muted); min-width: 0; overflow: hidden; }
  .table { margin-top: 0.5rem; font-size: 0.8rem; color: var(--muted); }
  .table summary { cursor: pointer; }
  table { border-collapse: collapse; margin-top: 0.3rem; }
  th, td { text-align: left; padding: 0.1rem 0.8rem 0.1rem 0; font-weight: 400; }
  td { color: var(--text); }
</style>
