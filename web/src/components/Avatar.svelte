<script lang="ts">
  // Profilbild oder Initiale als Kreis
  let { name, url = null, size = 40 }: { name: string; url?: string | null; size?: number } = $props();
  let failed = $state(false);
  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11));
</script>

<span class="avatar" style="--s: {size}px; --h: {hue}" aria-hidden="true">
  {#if url && !failed}
    <img src={url} alt="" loading="lazy" onerror={() => (failed = true)} />
  {:else}
    {name.slice(0, 1).toUpperCase()}
  {/if}
</span>

<style>
  .avatar {
    width: var(--s); height: var(--s); flex-shrink: 0;
    border-radius: 50%; overflow: hidden;
    display: inline-grid; place-items: center;
    font-weight: 600; font-size: calc(var(--s) * 0.42);
    background: hsl(var(--h) 35% 38%); color: hsl(var(--h) 60% 92%);
  }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
