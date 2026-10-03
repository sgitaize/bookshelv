<script lang="ts">
  import { t, i18n } from '../lib/i18n.svelte.ts';

  // Bücher (linke Achse) und Seiten (rechte Achse) pro Monat als zwei geglättete Linien (StoryGraph-Vorbild).
  // Ein Monat lässt sich antippen → onpick(index).
  let { data, onpick }: {
    data: { label: string; tip: string; books: number; pages: number }[];
    onpick?: (i: number) => void;
  } = $props();

  const W = 340, H = 190, L = 30, R = 40, T = 10, B = 24;
  const nf = (n: number) => n.toLocaleString(i18n.locale);
  /** obere Achsengrenze: 1/2/2,5/5 × 10^k, damit die Mitte eine runde Zahl ist */
  function nice(v: number) {
    if (v <= 2) return 2;
    const k = 10 ** Math.floor(Math.log10(v));
    return ([1, 2, 2.5, 5, 10].find(f => f * k >= v) ?? 10) * k;
  }
  const maxB = $derived(nice(Math.max(...data.map(d => d.books))));
  const maxP = $derived(nice(Math.max(...data.map(d => d.pages))));
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, data.length - 1);
  const y = (v: number, max: number) => T + (H - T - B) * (1 - v / max);
  const step = $derived((W - L - R) / Math.max(1, data.length - 1));

  // Catmull-Rom → Bézier; Überschwinger unter 0 werden durch clamp vermieden
  function curve(p: { x: number; y: number }[]) {
    const floor = H - B, c = (v: number) => Math.min(floor, v);
    let d = `M${p[0].x},${p[0].y}`;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i - 1] ?? p[i], b = p[i], n = p[i + 1], e = p[i + 2] ?? n;
      d += ` C${b.x + (n.x - a.x) / 6},${c(b.y + (n.y - a.y) / 6)} ${n.x - (e.x - b.x) / 6},${c(n.y - (e.y - b.y) / 6)} ${n.x},${n.y}`;
    }
    return d;
  }
  const books = $derived(data.map((d, i) => ({ x: x(i), y: y(d.books, maxB) })));
  const pages = $derived(data.map((d, i) => ({ x: x(i), y: y(d.pages, maxP) })));
  let hover = $state<number | null>(null);
</script>

<figure class="ml">
  <div class="legend">
    <span><i class="b"></i>{t('stats.lineBooks')}</span>
    <span><i class="p"></i>{t('stats.linePages')}</span>
  </div>
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={t('stats.perMonthBoth')}>
    {#each [0, 0.5, 1] as f}
      <line x1={L} x2={W - R} y1={y(f, 1)} y2={y(f, 1)} class="grid" />
      <text x={L - 6} y={y(f, 1) + 3.5} class="ax" text-anchor="end">{nf(maxB * f)}</text>
      <text x={W - R + 6} y={y(f, 1) + 3.5} class="ax">{nf(maxP * f)}</text>
    {/each}
    {#if hover !== null}<line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} class="cursor" />{/if}
    <path d={curve(pages)} class="line p" />
    <path d={curve(books)} class="line b" />
    {#each data as d, i}
      <circle cx={pages[i].x} cy={pages[i].y} r="3" class="dot p" />
      <circle cx={books[i].x} cy={books[i].y} r="3" class="dot b" />
      <text x={x(i)} y={H - 6} class="ax" text-anchor="middle">{d.label}</text>
      <!-- unsichtbare Spalte als Tippfläche -->
      <rect x={x(i) - step / 2} y={T} width={step} height={H - T} class="hit" role="button" tabindex="0"
        aria-label={`${d.tip}: ${nf(d.books)} ${t('stats.lineBooks')}, ${nf(d.pages)} ${t('stats.linePages')}`}
        onclick={() => onpick?.(i)} onkeydown={e => e.key === 'Enter' && onpick?.(i)}
        onpointerenter={() => (hover = i)} onpointerleave={() => (hover = null)} />
    {/each}
  </svg>
  <p class="tip small">
    {#if hover !== null}<strong>{data[hover].tip}</strong>: {nf(data[hover].books)} {t('stats.lineBooks')} · {nf(data[hover].pages)} {t('stats.linePages')}{:else}&nbsp;{/if}
  </p>
</figure>

<style>
  .ml { margin: 0; --c-b: #6f9fe0; --c-p: #d9603f; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .legend { display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; font-size: 0.8rem; color: var(--muted); margin-bottom: 0.4rem; }
  .legend i { display: inline-block; width: 22px; height: 10px; border-radius: 3px; margin-right: 0.35rem; vertical-align: -1px; }
  .legend .b { background: var(--c-b); } .legend .p { background: var(--c-p); }
  .grid { stroke: var(--line); }
  .cursor { stroke: var(--muted); stroke-dasharray: 3 3; }
  .ax { font-size: 9px; fill: var(--muted); }
  .line { fill: none; stroke-width: 2.5; stroke-linecap: round; }
  .line.b, .dot.b { stroke: var(--c-b); } .line.p, .dot.p { stroke: var(--c-p); }
  .dot { stroke-width: 2; fill: var(--surface); }
  .hit { fill: transparent; cursor: pointer; outline: none; }
  .hit:focus-visible { fill: rgb(127 127 127 / 0.12); }
  .tip { text-align: center; margin: 0.3rem 0 0; color: var(--muted); min-height: 1.3em; }
</style>
