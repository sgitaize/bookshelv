<script lang="ts">
  import { onMount } from 'svelte';
  import WebScanner from './WebScanner.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.ts';
  import { app, nativeScan } from '../lib/app.svelte.ts';

  // In der App: nativer Scanner (iOS VisionKit) im Vollbild statt Kamera im Browser.
  // multi: Scanner bleibt offen (Massen-Scan), sonst schließt er nach dem ersten Treffer.
  let { onscan, paused = false, ok = 0, multi = false }: { onscan: (isbn: string) => void; paused?: boolean; ok?: number; multi?: boolean } = $props();

  const native = $derived(!!app.info?.scanner);
  let open = $state(false);

  async function launch() {
    if (open) return;
    open = true;
    try { await nativeScan({ multi, onIsbn: isbn => onscan(isbn) }); } finally { open = false; }
  }
  // beim Öffnen der Seite gleich loslegen (wie die Kamera im Browser)
  onMount(() => { if (native && !paused) launch(); });
</script>

{#if native}
  <div class="native card">
    <button class="primary big" onclick={launch} disabled={open}>
      <Icon name="scan" size={22} /> {open ? t('scan.nativeOpen') : t('scan.nativeStart')}
    </button>
    <p class="muted small">{multi ? t('scan.nativeHintMulti') : t('scan.nativeHint')}</p>
  </div>
{:else}
  <WebScanner {onscan} {paused} {ok} />
{/if}

<style>
  .native { display: grid; gap: 0.6rem; justify-items: center; text-align: center; padding: 1.6rem 1rem; }
  .big { font-size: 1.05rem; padding: 0.85em 1.4em; display: inline-flex; gap: 0.5em; align-items: center; }
  .native p { margin: 0; }
</style>
