<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';

  // Rangliste als liegende Balken (Genres, Autoren, Formate) – eine Reihe, Werte rechts in Textfarbe
  let { data, label }: { data: { label: string; value: number }[]; label: string } = $props();
  const max = $derived(Math.max(1, ...data.map(d => d.value)));
</script>

<figure class="chart" aria-label={label}>
  <ol>
    {#each data as d}
      <li title="{d.label}: {d.value}">
        <span class="lbl">{d.label}</span>
        <span class="track"><span class="bar" style="width: {(d.value / max) * 100}%"></span></span>
        <span class="val">{d.value}</span>
      </li>
    {/each}
  </ol>
  <details class="table">
    <summary>{t('stats.table')}</summary>
    <table><tbody>{#each data as d}<tr><th>{d.label}</th><td>{d.value}</td></tr>{/each}</tbody></table>
  </details>
</figure>

<style>
  .chart { margin: 0; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.45rem; }
  li { display: grid; grid-template-columns: minmax(6rem, 38%) 1fr 2rem; align-items: center; gap: 0.6rem; }
  .lbl { font-size: 0.82rem; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track { height: 12px; }
  .bar { display: block; height: 100%; background: var(--accent); border-radius: 0 4px 4px 0; min-width: 2px; }
  li:hover .bar { background: var(--accent-2); }
  .val { font-size: 0.8rem; color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
  .table { margin-top: 0.5rem; font-size: 0.8rem; color: var(--muted); }
  .table summary { cursor: pointer; }
  table { border-collapse: collapse; margin-top: 0.3rem; }
  th, td { text-align: left; padding: 0.1rem 0.8rem 0.1rem 0; font-weight: 400; }
  td { color: var(--text); }
</style>
