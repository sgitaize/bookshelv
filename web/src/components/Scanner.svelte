<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.ts';

  let { onscan, paused = false }: { onscan: (isbn: string) => void; paused?: boolean } = $props();

  let video: HTMLVideoElement;
  let error = $state<string | null>(null);
  let starting = $state(true);
  let torch = $state(false);
  let torchAvailable = $state(false);
  let flash = $state(false);

  let stream: MediaStream | null = null;
  let stopped = false;
  let lastCode = '';
  let lastAt = 0;

  type Detect = (source: HTMLVideoElement) => Promise<string | null>;

  /** Natives BarcodeDetector (Chrome/Android) oder zxing-wasm als Fallback (Safari/iOS, Firefox) */
  async function createDetector(): Promise<Detect> {
    const BD = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
    if (BD && (await BD.getSupportedFormats?.())?.includes('ean_13')) {
      const detector = new BD({ formats: ['ean_13'] });
      return async src => (await detector.detect(src))[0]?.rawValue ?? null;
    }
    const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
      import('zxing-wasm/reader'),
      import('zxing-wasm/reader/zxing_reader.wasm?url')
    ]);
    // WASM vom eigenen Server statt vom CDN (DSGVO)
    prepareZXingModule({
      overrides: { locateFile: (p: string, prefix: string) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) }
    });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    return async src => {
      // nur das mittlere Band auswerten – schneller und der Barcode liegt ohnehin im Rahmen
      const w = src.videoWidth, h = src.videoHeight;
      if (!w || !h) return null;
      const bandH = Math.round(h * 0.45);
      canvas.width = w;
      canvas.height = bandH;
      ctx.drawImage(src, 0, (h - bandH) / 2, w, bandH, 0, 0, w, bandH);
      const res = await readBarcodes(ctx.getImageData(0, 0, w, bandH), { formats: ['EAN13'], tryHarder: true, maxNumberOfSymbols: 1 });
      return res[0]?.text ?? null;
    };
  }

  onMount(() => {
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        error = t('scan.noCamera');
        starting = false;
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        if (stopped) return stream.getTracks().forEach(t => t.stop());
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        torchAvailable = !!(track.getCapabilities?.() as { torch?: boolean })?.torch;
        const detect = await createDetector();
        starting = false;
        loop(detect);
      } catch (e) {
        starting = false;
        error = (e as Error).name === 'NotAllowedError'
          ? t('scan.denied')
          : t('scan.failed');
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  });

  async function loop(detect: Detect) {
    while (!stopped) {
      if (!paused && video.readyState >= 2) {
        try {
          const code = await detect(video);
          // nur Buch-EANs (Bookland 978/979); gleichen Code nicht mehrfach hintereinander melden
          if (code && /^97[89]\d{10}$/.test(code) && (code !== lastCode || Date.now() - lastAt > 4000)) {
            lastCode = code;
            lastAt = Date.now();
            flash = true;
            setTimeout(() => (flash = false), 350);
            navigator.vibrate?.(60);
            onscan(code);
          }
        } catch { /* einzelner Frame fehlgeschlagen */ }
      }
      await new Promise(r => setTimeout(r, 180));
    }
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    torch = !torch;
    await track.applyConstraints({ advanced: [{ torch } as MediaTrackConstraintSet] }).catch(() => (torch = false));
  }
</script>

<div class="scanner" class:flash>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} playsinline muted></video>
  <div class="frame"><span class="laser"></span></div>
  {#if starting}
    <div class="overlay"><div class="spinner"></div><span>{t('scan.starting')}</span></div>
  {:else if error}
    <div class="overlay"><Icon name="camera" size={32} /><span>{error}</span></div>
  {/if}
  {#if torchAvailable}
    <button class="torch icon" class:on={torch} onclick={toggleTorch} aria-label={t('scan.torch')}>
      <Icon name="sparkle" />
    </button>
  {/if}
</div>

<style>
  .scanner {
    position: relative;
    aspect-ratio: 4 / 3;
    max-height: 55dvh;
    width: 100%;
    border-radius: var(--radius);
    overflow: hidden;
    background: #000;
    box-shadow: var(--shadow);
  }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .frame {
    position: absolute;
    inset: 27% 10%;
    border-radius: 12px;
    box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.45);
    border: 2px solid rgb(255 255 255 / 0.85);
    transition: border-color 0.2s;
  }
  .flash .frame { border-color: var(--ok); }
  .laser {
    position: absolute;
    left: 6%; right: 6%; top: 50%;
    height: 2px;
    background: var(--accent);
    box-shadow: 0 0 12px var(--accent);
    animation: sweep 1.8s ease-in-out infinite alternate;
  }
  @keyframes sweep { from { top: 18%; } to { top: 82%; } }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.8rem;
    padding: 2rem;
    text-align: center;
    color: #eee;
    background: rgb(0 0 0 / 0.6);
  }
  .torch { position: absolute; right: 12px; bottom: 12px; background: rgb(0 0 0 / 0.5); color: #fff; border-color: transparent; }
  .torch.on { background: var(--accent); color: var(--accent-ink); }
</style>
