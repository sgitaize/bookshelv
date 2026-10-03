<script lang="ts">
  // Buchcover mit leichtem 3D-Buchrücken; ohne Bild wird ein farbiges Cover aus dem Titel erzeugt
  let { url, title, authors = [], size = 'md' }: {
    url: string | null; title: string; authors?: string[]; size?: 'sm' | 'md' | 'lg';
  } = $props();

  let failed = $state(false);

  const hue = $derived([...title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7));
</script>

<div class="cover {size}" style="--hue: {hue}">
  {#if url && !failed}
    <img src={url} alt="" loading="lazy" decoding="async" onerror={() => (failed = true)} />
  {:else}
    <div class="generated">
      <span class="t">{title}</span>
      {#if authors.length}<span class="a">{authors[0]}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .cover {
    position: relative;
    aspect-ratio: 2 / 3;
    border-radius: 3px 6px 6px 3px;
    overflow: hidden;
    background: var(--surface-3);
    box-shadow: var(--cover-shadow);
  }
  /* Buchrücken-Glanz links */
  .cover::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgb(0 0 0 / 0.18) 0, rgb(255 255 255 / 0.15) 2.5%, rgb(0 0 0 / 0.05) 5%, transparent 9%);
    pointer-events: none;
  }
  .sm { width: 56px; flex-shrink: 0; }
  .md { width: 100%; }
  .lg { width: min(220px, 55vw); }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .generated {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 14% 12% 12% 16%;
    background: linear-gradient(160deg, hsl(var(--hue) 35% 42%), hsl(calc(var(--hue) + 30) 40% 28%));
    color: hsl(var(--hue) 40% 92%);
  }
  .t { font-weight: 600; font-size: 0.95em; line-height: 1.15; overflow-wrap: anywhere; }
  .a { font-size: 0.7em; opacity: 0.8; }
  .sm .generated { padding: 10%; }
  .sm .t { font-size: 0.5rem; }
  .sm .a { display: none; }
  .lg .t { font-size: 1.4rem; }
</style>
