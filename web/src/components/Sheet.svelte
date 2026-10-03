<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.ts';

  // Bottom-Sheet auf dem Handy, zentrierter Dialog auf dem Desktop
  let { open, onclose, children, title }: { open: boolean; onclose: () => void; children: Snippet; title?: string } = $props();

  function onkey(e: KeyboardEvent) {
    if (open && e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onkey} />

{#if open}
  <div class="backdrop" transition:fade={{ duration: 150 }} onclick={onclose} role="presentation"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label={title} transition:fly={{ y: 400, duration: 260, opacity: 1 }}>
    <div class="head">
      {#if title}<h2>{title}</h2>{/if}
      <button class="icon ghost" onclick={onclose} aria-label={t('common.close')}><Icon name="x" /></button>
    </div>
    <div class="body">{@render children()}</div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.55); backdrop-filter: blur(3px); z-index: 50; }
  .sheet {
    position: fixed;
    z-index: 51;
    left: 0; right: 0; bottom: 0;
    max-height: 92dvh;
    overflow: auto;
    background: var(--surface);
    border-radius: 22px 22px 0 0;
    border: 1px solid var(--line);
    padding: 0.6rem 1.2rem calc(1.4rem + env(safe-area-inset-bottom));
    box-shadow: 0 -10px 40px rgb(0 0 0 / 0.4);
  }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; position: sticky; top: 0; background: var(--surface); padding-top: 0.4rem; z-index: 1; }
  .head h2 { margin: 0; }
  .head::before {
    content: ''; position: absolute; left: 50%; top: 0; translate: -50% 0;
    width: 38px; height: 4px; border-radius: 4px; background: var(--surface-3);
  }
  .body { padding-top: 0.6rem; }
  @media (min-width: 720px) {
    .sheet {
      left: 50%; right: auto; bottom: auto; top: 50%;
      translate: -50% -50%;
      width: min(560px, 92vw);
      border-radius: 20px;
    }
    .head::before { display: none; }
  }
</style>
