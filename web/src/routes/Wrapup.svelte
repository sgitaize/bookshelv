<script lang="ts">
  // Bild in der gewählten App-Schrift zeichnen
  const font = () => getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'sans-serif';
  import { api, type Stats, type BookBrief } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, i18n } from '../lib/i18n.svelte.ts';
  import Icon from '../components/Icon.svelte';

  const year = router.query.get('year') ?? String(new Date().getFullYear());
  let s = $state<Stats | null>(null);
  let canvas = $state<HTMLCanvasElement>();
  let blob: Blob | null = null;

  $effect(() => { api.get<Stats>(`/stats?year=${year}`).then(r => (s = r)).catch(toastError); });
  $effect(() => { if (s && canvas && s.totals.books) draw(s, canvas); });

  const W = 1080, H = 1350;
  const C = { bg: '#121516', card: '#1f2526', text: '#e9eded', muted: '#95a0a1', accent: '#5fb0b3', star: '#f5b82e' };

  function loadImg(url: string | null): Promise<HTMLImageElement | null> {
    if (!url) return Promise.resolve(null);
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    });
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  /** Cover zeichnen; ohne Bild ein farbiges Ersatz-Cover mit Titel */
  function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, b: BookBrief, x: number, y: number, w: number, h: number) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 8);
    ctx.clip();
    if (img) {
      const scale = Math.max(w / img.width, h / img.height);
      ctx.drawImage(img, x + (w - img.width * scale) / 2, y + (h - img.height * scale) / 2, img.width * scale, img.height * scale);
    } else {
      ctx.fillStyle = '#33777c';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#e9eded';
      ctx.font = `600 ${Math.round(w / 8)}px ${font()}`;
      wrap(ctx, b.title, x + 12, y + 24 + w / 8, w - 24, w / 7, 4);
    }
    ctx.restore();
  }

  function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
    const words = text.split(' ');
    let line = '', n = 0;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y + n * lh);
        line = w;
        if (++n >= maxLines) return;
      } else line = test;
    }
    ctx.fillText(line, x, y + n * lh);
  }

  function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
    let s = text;
    while (ctx.measureText(s).width > maxW && s.length > 3) s = s.slice(0, -2);
    return s === text ? s : s.trimEnd() + '…';
  }

  async function draw(s: Stats, cv: HTMLCanvasElement) {
    await document.fonts.ready;
    await Promise.all(['400', '700'].map(wt => document.fonts.load(`${wt} 32px ${font()}`).catch(() => {})));
    const ctx = cv.getContext('2d')!;
    cv.width = W; cv.height = H;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // Kopf
    ctx.fillStyle = C.accent;
    ctx.font = `600 64px ${font()}`;
    ctx.fillText(t('wrap.title', { y: year }), 70, 130);
    ctx.fillStyle = C.muted;
    ctx.font = `400 32px ${font()}`;
    ctx.fillText(`@${s.user.username} · bookshelv`, 70, 180);

    // Vier Cover: erstes, letztes, längstes, kürzestes
    const h = s.highlights;
    const four = [[t('wrap.first'), h.first], [t('wrap.last'), h.last], [t('wrap.longest'), h.longest], [t('wrap.shortest'), h.shortest]] as const;
    const cw = 210, ch = 315, gap = (W - 140 - cw * 4) / 3;
    const imgs = await Promise.all(four.map(([, b]) => loadImg(b?.coverUrl ?? null)));
    four.forEach(([label, b], i) => {
      const x = 70 + i * (cw + gap);
      if (b) cover(ctx, imgs[i], b, x, 240, cw, ch);
      ctx.fillStyle = C.muted;
      ctx.font = `500 26px ${font()}`;
      ctx.fillText(label, x, 240 + ch + 40);
    });

    // Zahlen
    const tiles = [
      [s.totals.books.toLocaleString(i18n.locale), t('wrap.books')],
      [s.totals.pages.toLocaleString(i18n.locale), t('wrap.pages')],
      [s.totals.avgRating ? s.totals.avgRating.toLocaleString(i18n.locale, { maximumFractionDigits: 1 }) + ' ★' : '–', t('wrap.stars')]
    ];
    const tw = (W - 140 - 2 * 24) / 3;
    tiles.forEach(([v, l], i) => {
      const x = 70 + i * (tw + 24);
      ctx.fillStyle = C.card;
      roundRect(ctx, x, 650, tw, 150, 18);
      ctx.fill();
      ctx.fillStyle = C.text;
      ctx.font = `600 60px ${font()}`;
      ctx.fillText(v, x + 28, 735);
      ctx.fillStyle = C.muted;
      ctx.font = `400 26px ${font()}`;
      ctx.fillText(l, x + 28, 778);
    });

    // Genres und Autor:innen
    const lists = [[t('wrap.topGenres'), s.genres.slice(0, 3).map(g => g.name)], [t('wrap.topAuthors'), s.authors.slice(0, 3).map(a => a.name)]] as const;
    lists.filter(([, items]) => items.length).forEach(([title, items], i) => {
      const x = 70 + i * ((W - 140) / 2 + 12);
      ctx.fillStyle = C.accent;
      ctx.font = `600 32px ${font()}`;
      ctx.fillText(title, x, 870);
      ctx.fillStyle = C.text;
      ctx.font = `400 30px ${font()}`;
      items.forEach((it, j) => ctx.fillText(fit(ctx, `${j + 1}. ${it}`, (W - 140) / 2 - 30), x, 920 + j * 44));
    });

    // 5-Sterne-Bücher
    if (h.fiveStars.length) {
      ctx.fillStyle = C.star;
      ctx.font = `600 32px ${font()}`;
      ctx.fillText('★ ' + t('wrap.fiveStars'), 70, 1090);
      const five = h.fiveStars.slice(0, 6);
      const fimgs = await Promise.all(five.map(b => loadImg(b.coverUrl)));
      const fw = 120, fh = 180;
      five.forEach((b, i) => cover(ctx, fimgs[i], b, 70 + i * (fw + 20), 1115, fw, fh));
    }

    // Fuß
    ctx.fillStyle = C.muted;
    ctx.font = `400 24px ${font()}`;
    ctx.textAlign = 'right';
    ctx.fillText(location.host, W - 70, H - 40);
    ctx.textAlign = 'left';

    blob = await new Promise(res => cv.toBlob(b => res(b), 'image/png'));
  }

  function save() {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bookshelv-${year}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function share() {
    if (!blob) return;
    const file = new File([blob], `bookshelv-${year}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: t('wrap.title', { y: year }) }).catch(() => {});
    else save();
  }
</script>

<section class="stack">
  <a href="/stats?year={year}" class="back"><Icon name="back" size={16} /> {t('stats.title')}</a>
  <h1>{t('stats.wrapup', { y: year })}</h1>
  {#if !s}
    <div class="spinner"></div>
  {:else if !s.totals.books}
    <p class="empty">{t('wrap.empty', { y: year })}</p>
  {:else}
    <canvas bind:this={canvas} aria-label={t('wrap.title', { y: year })}></canvas>
    <div class="row">
      <button class="primary" onclick={share}><Icon name="link" size={16} /> {t('wrap.share')}</button>
      <button onclick={save}><Icon name="download" size={16} /> {t('wrap.save')}</button>
    </div>
  {/if}
</section>

<style>
  section { max-width: 560px; margin: 0 auto; }
  .back { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--muted); }
  canvas { width: 100%; height: auto; aspect-ratio: 1080 / 1350; border-radius: var(--radius); box-shadow: var(--shadow); background: #121516; }
</style>
