<script lang="ts">
  // Sterne anzeigen oder (mit onchange) auswählen; linke Sternhälfte = halber Stern
  let { value = null, size = 18, onchange }: { value?: number | null; size?: number; onchange?: (v: number | null) => void } = $props();

  let hover = $state<number | null>(null);
  const shown = $derived(hover ?? value ?? 0);

  function fill(i: number) {
    return shown >= i ? 1 : shown >= i - 0.5 ? 0.5 : 0;
  }
  function pick(v: number) {
    // erneutes Antippen des gleichen Werts löscht die Bewertung
    onchange?.(v === value ? null : v);
  }
  function key(e: KeyboardEvent) {
    if (!onchange) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onchange(Math.min(5, (value ?? 0) + 0.5)); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); const v = (value ?? 0) - 0.5; onchange(v < 0.5 ? null : v); }
  }
</script>

{#snippet star(f: number)}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="bg" d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z" />
    {#if f}
      <path class="fg" style={f === 0.5 ? 'clip-path: inset(0 50% 0 0)' : ''} d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z" />
    {/if}
  </svg>
{/snippet}

{#if onchange}
  <div class="stars input" role="slider" tabindex="0" aria-label="Bewertung" aria-valuemin="0" aria-valuemax="5"
    aria-valuenow={value ?? 0} aria-valuetext={value ? `${value} von 5 Sternen` : 'keine Bewertung'}
    onkeydown={key} onmouseleave={() => (hover = null)} style="--s: {size}px">
    {#each [1, 2, 3, 4, 5] as i}
      <span class="star">
        {@render star(fill(i))}
        <button type="button" class="half l" tabindex="-1" aria-label="{i - 0.5} Sterne"
          onmouseenter={() => (hover = i - 0.5)} onclick={() => pick(i - 0.5)}></button>
        <button type="button" class="half r" tabindex="-1" aria-label="{i} Sterne"
          onmouseenter={() => (hover = i)} onclick={() => pick(i)}></button>
      </span>
    {/each}
  </div>
{:else}
  <span class="stars" style="--s: {size}px" aria-label={value ? `${value} von 5 Sternen` : 'keine Bewertung'} role="img">
    {#each [1, 2, 3, 4, 5] as i}
      <span class="star">
        {@render star(fill(i))}
      </span>
    {/each}
  </span>
{/if}

<style>
  .stars { display: inline-flex; gap: calc(var(--s) * 0.08); vertical-align: middle; }
  .star { position: relative; width: var(--s); height: var(--s); display: inline-block; }
  svg { width: 100%; height: 100%; display: block; }
  .bg { fill: var(--surface-3); }
  .fg { fill: var(--star); }
  .input { outline: none; border-radius: 6px; }
  .input:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent); }
  .input .star { cursor: pointer; }
  .half { position: absolute; top: 0; bottom: 0; width: 50%; padding: 0; border: none; background: none; border-radius: 0; }
  .half:hover { background: none; }
  .half:active { transform: none; }
  .l { left: 0; }
  .r { right: 0; }
</style>
