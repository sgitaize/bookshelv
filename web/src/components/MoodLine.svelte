<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';

  // Stimmungskurve (StoryGraph-Vorbild): -1 = düster … +1 = leicht, eine geglättete Linie über die Monate
  let { data }: { data: { label: string; value: number | null }[] } = $props();

  const W = 320, H = 160, PAD = 12;
  const pts = $derived(data.map((d, i) => d.value === null ? null : {
    x: PAD + (i * (W - 2 * PAD)) / Math.max(1, data.length - 1),
    y: H / 2 - (d.value * (H / 2 - PAD))
  }));
  // Catmull-Rom → Bézier, nur über zusammenhängende Punkte
  const path = $derived.by(() => {
    const p = pts.filter((x): x is { x: number; y: number } => !!x);
    if (p.length < 2) return p.length ? `M${p[0].x},${p[0].y}h1` : '';
    let d = `M${p[0].x},${p[0].y}`;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i - 1] ?? p[i], b = p[i], c = p[i + 1], e = p[i + 2] ?? c;
      d += ` C${b.x + (c.x - a.x) / 6},${b.y + (c.y - a.y) / 6} ${c.x - (e.x - b.x) / 6},${c.y - (e.y - b.y) / 6} ${c.x},${c.y}`;
    }
    return d;
  });
</script>

<figure class="mood">
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={t('stats.moodMap')}>
    <defs>
      <linearGradient id="moodgrad" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="var(--mood-light)" />
        <stop offset="1" stop-color="var(--mood-dark)" />
      </linearGradient>
    </defs>
    <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} class="mid" />
    <path d={path} fill="none" stroke="url(#moodgrad)" stroke-width="4" stroke-linecap="round" />
  </svg>
  <div class="ends"><span>{t('stats.moodLight')}</span><span>{t('stats.moodDark')}</span></div>
  <div class="xaxis">{#each data as d}<span>{d.label}</span>{/each}</div>
</figure>

<style>
  .mood { margin: 0; position: relative; --mood-light: #6cc7a3; --mood-dark: #7a5ca8; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .mid { stroke: var(--line); stroke-dasharray: 3 4; }
  .ends { position: absolute; top: 0; right: 0; bottom: 1.4rem; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }
  .ends span { font-size: 0.66rem; color: var(--muted); }
  .xaxis { display: flex; justify-content: space-between; margin-top: 0.3rem; }
  .xaxis span { font-size: 0.66rem; color: var(--muted); flex: 1; text-align: center; min-width: 0; overflow: hidden; }
</style>
