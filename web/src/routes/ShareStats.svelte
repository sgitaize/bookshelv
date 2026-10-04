<script lang="ts">
  // Statistik als teilbares Bild (Instagram): Zeitraum Monat/Quartal/Jahr, Vorlage bzw. eigene Auswahl an Bausteinen,
  // Format Story/Post/Quadrat, Farbschema. Gezeichnet auf ein Canvas in der App-Schrift, gespeichert als PNG.
  import { api, type Stats, type BookBrief, type StatGroup } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, tn, i18n, type Key } from '../lib/i18n.svelte.ts';
  import Icon from '../components/Icon.svelte';

  type Kind = 'month' | 'quarter' | 'year';
  type Block = 'numbers' | 'covers' | 'top' | 'genres' | 'authors' | 'moods' | 'stars' | 'facts';
  type Format = 'story' | 'post' | 'square';
  type Palette = { bg: string; card: string; text: string; muted: string; accent: string; star: string };

  const BLOCKS: Block[] = ['numbers', 'covers', 'top', 'genres', 'authors', 'moods', 'stars', 'facts'];
  const TEMPLATES: Record<string, Block[]> = {
    wall: ['numbers', 'covers'],
    highlight: ['top', 'numbers', 'moods'],
    numbers: ['numbers', 'genres', 'authors', 'stars'],
    mix: ['numbers', 'covers', 'genres', 'moods']
  };
  const SIZES: Record<Format, [number, number]> = { story: [1080, 1920], post: [1080, 1350], square: [1080, 1080] };
  const PALETTES: Record<string, Palette> = {
    night: { bg: '#121516', card: '#1f2526', text: '#e9eded', muted: '#95a0a1', accent: '#5fb0b3', star: '#f5b82e' },
    paper: { bg: '#f3ecdf', card: '#e7dccb', text: '#2b2622', muted: '#7a6f63', accent: '#b23a2e', star: '#c98a12' },
    ink: { bg: '#141b2d', card: '#1f2942', text: '#eef0f6', muted: '#9aa3ba', accent: '#d9b45a', star: '#d9b45a' },
    forest: { bg: '#14201a', card: '#1f3027', text: '#e7efe9', muted: '#97ab9e', accent: '#7cc49a', star: '#f2c14e' },
    rose: { bg: '#2a1b22', card: '#3b2731', text: '#f6e9ee', muted: '#c7a5b3', accent: '#f08fab', star: '#ffc861' }
  };

  // Ausgangslage: Zeitraum aus der URL (?period=2026-09 | 2026-Q3 | 2026), sonst aktueller Monat
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const initial = router.query.get('period') ?? curMonth;
  let kind = $state<Kind>(/Q/.test(initial) ? 'quarter' : initial.length === 4 ? 'year' : 'month');
  let period = $state(initial);
  let template = $state<string>('wall');
  let blocks = $state<Block[]>([...TEMPLATES.wall]);
  let format = $state<Format>('story');
  let palette = $state('night');

  let base = $state<Stats | null>(null); // nur für Auswahllisten (Jahre/Monate mit Daten)
  let s = $state<Stats | null>(null);
  let canvas = $state<HTMLCanvasElement>();
  let blob: Blob | null = null;
  let dropped = $state<Block[]>([]);

  $effect(() => { api.get<Stats>('/stats').then(r => (base = r)).catch(toastError); });
  $effect(() => { const p = period; s = null; api.get<Stats>(`/stats?period=${p}`).then(r => { if (p === period) s = r; }).catch(toastError); });
  $effect(() => {
    // alle Abhängigkeiten lesen, damit jede Änderung neu zeichnet
    const deps = [s, canvas, format, palette, blocks.join(), i18n.lang];
    if (deps[0] && deps[1]) draw(s!, canvas!);
  });

  const months = $derived([...new Set([curMonth, ...(base?.months ?? [])])].sort().reverse());
  const quarters = $derived([...new Set(months.map(m => `${m.slice(0, 4)}-Q${Math.ceil(Number(m.slice(5, 7)) / 3)}`))]);
  const years = $derived([...new Set([String(now.getFullYear()), ...(base?.years ?? [])])].sort().reverse());
  const options = $derived(kind === 'month' ? months : kind === 'quarter' ? quarters : years);

  function setKind(k: Kind) {
    kind = k;
    const y = period.slice(0, 4);
    period = k === 'year' ? y : k === 'quarter' ? (quarters.find(q => q.startsWith(y)) ?? quarters[0]) : (months.find(m => m.startsWith(y)) ?? months[0]);
  }
  function pickTemplate(id: string) { template = id; blocks = [...TEMPLATES[id]]; }
  function toggle(b: Block) {
    template = 'custom';
    blocks = blocks.includes(b) ? blocks.filter(x => x !== b) : [...blocks, b];
  }

  const label = (p: string) => {
    if (/^\d{4}$/.test(p)) return p;
    const q = p.match(/^(\d{4})-Q(\d)$/);
    if (q) return t('share.quarterLabel', { q: q[2], y: q[1] });
    const d = new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1);
    return d.toLocaleDateString(i18n.locale, { month: 'long', year: 'numeric' });
  };
  const titleFor = (p: string) => /^\d{4}$/.test(p) ? t('share.titleYear', { p }) : /Q/.test(p) ? t('share.titleQuarter', { p: label(p) }) : t('share.titleMonth', { p: label(p) });

  // ---------- Zeichnen ----------
  const font = () => getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'sans-serif';
  const headFont = () => getComputedStyle(document.documentElement).getPropertyValue('--font-head').trim() || font();
  const nf = (n: number) => n.toLocaleString(i18n.locale);

  const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
  function loadImg(url: string | null): Promise<HTMLImageElement | null> {
    if (!url) return Promise.resolve(null);
    if (!imgCache.has(url)) imgCache.set(url, new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    }));
    return imgCache.get(url)!;
  }

  function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
    const words = text.split(' ');
    let line = '', n = 0;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        if (n === maxLines - 1) { ctx.fillText(fit(ctx, `${line} ${w}`, maxW), x, y + n * lh); return n + 1; }
        ctx.fillText(line, x, y + n * lh);
        line = w; n++;
      } else line = test;
    }
    ctx.fillText(fit(ctx, line, maxW), x, y + n * lh);
    return n + 1;
  }
  function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
    let r = text;
    while (ctx.measureText(r).width > maxW && r.length > 3) r = r.slice(0, -2);
    return r === text ? r : r.trimEnd() + '…';
  }
  function cover(ctx: CanvasRenderingContext2D, P: Palette, img: HTMLImageElement | null, b: BookBrief, x: number, y: number, w: number, h: number) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = w / 10; ctx.shadowOffsetY = w / 30;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(3, w / 30)); ctx.fillStyle = P.card; ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(3, w / 30)); ctx.clip();
    if (img) {
      const sc = Math.max(w / img.width, h / img.height);
      ctx.drawImage(img, x + (w - img.width * sc) / 2, y + (h - img.height * sc) / 2, img.width * sc, img.height * sc);
    } else {
      const hue = [...b.title].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);
      ctx.fillStyle = `hsl(${hue} 35% 38%)`; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = `hsl(${hue} 40% 92%)`;
      const fs = Math.max(10, Math.round(w / 8));
      ctx.font = `600 ${fs}px ${font()}`;
      wrap(ctx, b.title, x + w * 0.1, y + w * 0.12 + fs, w * 0.8, fs * 1.2, 5);
    }
    ctx.restore();
  }
  function heading(ctx: CanvasRenderingContext2D, P: Palette, text: string, x: number, y: number) {
    ctx.fillStyle = P.accent; ctx.font = `600 34px ${headFont()}`; ctx.fillText(text, x, y + 34);
    return 56;
  }

  /** feste Höhe je Baustein (Cover-Wand nimmt den Rest) */
  function heightOf(b: Block, st: Stats, w: number, ctx: CanvasRenderingContext2D): number {
    switch (b) {
      case 'numbers': return 170;
      case 'top': return st.highlights.top ? 380 : 0;
      case 'genres': return st.genres.length ? 56 + Math.min(4, st.genres.length) * 54 : 0;
      case 'authors': return st.authors.length ? 56 + Math.min(3, st.authors.length) * 48 : 0;
      case 'stars': return st.ratings.some(r => r.n) ? 56 + 5 * 42 : 0;
      case 'facts': return 56 + facts(st).length * 48;
      case 'moods': {
        if (!st.moods.length) return 0;
        ctx.font = `500 30px ${font()}`;
        let x = 0, rows = 1;
        for (const m of st.moods.slice(0, 8)) {
          const cw = ctx.measureText(t(`mood.${m.name}` as Key)).width + 56;
          if (x + cw > w) { rows++; x = 0; }
          x += cw + 14;
        }
        return 56 + rows * 66;
      }
      case 'covers': return 0;
    }
  }
  function facts(st: Stats): [string, string][] {
    const out: [string, string][] = [];
    if (st.highlights.longest) out.push([t('share.factLongest'), `${st.highlights.longest.title} · ${nf(st.highlights.longest.pages ?? 0)} ${t('wrap.pages')}`]);
    if (st.totals.avgDays != null) out.push([t('share.factDays'), tn('share.days', st.totals.avgDays)]);
    if (st.paces[0]) out.push([t('share.factPace'), t(`pace.${st.paces[0].name}` as Key)]);
    if (st.totals.dnf) out.push([t('share.factDnf'), String(st.totals.dnf)]);
    return out;
  }

  async function draw(st: Stats, cv: HTMLCanvasElement) {
    await document.fonts.ready;
    await Promise.all(['400', '600', '700'].map(wt => document.fonts.load(`${wt} 32px ${font()}`).catch(() => {})));
    await document.fonts.load(`400 40px ${headFont()}`).catch(() => {});
    const [W, H] = SIZES[format];
    const P = PALETTES[palette];
    const ctx = cv.getContext('2d')!;
    cv.width = W; cv.height = H;
    const X = 72, CW = W - 2 * X;
    // Instagram-Story: oben/unten Platz für Profilzeile und Antwortfeld lassen
    const top = format === 'story' ? 200 : 80, bottom = format === 'story' ? 200 : 70;

    // Hintergrund mit sanftem Lichtschein in der Akzentfarbe
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.85, H * 0.05, 0, W * 0.85, H * 0.05, W * 0.9);
    g.addColorStop(0, P.accent + '40'); g.addColorStop(1, P.accent + '00');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Kopf
    let y = top;
    ctx.fillStyle = P.text; ctx.font = `400 72px ${headFont()}`;
    ctx.fillText(fit(ctx, titleFor(st.period ?? period), CW), X, y + 64);
    ctx.fillStyle = P.muted; ctx.font = `400 32px ${font()}`;
    ctx.fillText(`@${st.user.username} · bookshelv`, X, y + 116);
    y += 160;

    const footerY = H - bottom + 40;
    if (!st.totals.books) {
      ctx.fillStyle = P.muted; ctx.font = `400 36px ${font()}`;
      wrap(ctx, t('share.empty'), X, y + 60, CW, 48, 3);
    } else {
      // Platz verteilen: feste Bausteine zuerst; passt etwas nicht, fällt es weg; Cover-Wand bekommt den Rest
      const gap = 44;
      const avail = H - bottom - y - 20;
      const wanted = BLOCKS.filter(b => blocks.includes(b));
      const order = blocks.filter(b => wanted.includes(b));
      const hs = new Map(order.map(b => [b, heightOf(b, st, CW, ctx)]));
      const minCovers = order.includes('covers') ? 260 : 0;
      const used = () => order.filter(b => b !== 'covers' && hs.get(b)! > 0).reduce((a, b) => a + hs.get(b)! + gap, 0);
      const drop: Block[] = [];
      while (used() + minCovers > avail && order.some(b => b !== 'covers' && hs.get(b)! > 0)) {
        const last = [...order].reverse().find(b => b !== 'covers' && hs.get(b)! > 0)!;
        hs.set(last, 0); drop.push(last);
      }
      dropped = drop;
      if (order.includes('covers')) hs.set('covers', avail - used());
      // ohne Cover-Wand: Inhalt vertikal mittig statt oben kleben (v. a. im Story-Format)
      else y += Math.max(0, (avail - used() + gap) / 2);

      for (const b of order) {
        const h = hs.get(b)!;
        if (h <= 0) continue;
        await drawBlock(ctx, P, st, b, X, y, CW, h);
        y += h + gap;
      }
    }

    ctx.fillStyle = P.muted; ctx.font = `400 26px ${font()}`;
    ctx.textAlign = 'right'; ctx.fillText(location.host, W - X, footerY); ctx.textAlign = 'left';
    blob = await new Promise(res => cv.toBlob(b => res(b), 'image/png'));
  }

  async function drawBlock(ctx: CanvasRenderingContext2D, P: Palette, st: Stats, b: Block, x: number, y: number, w: number, h: number) {
    switch (b) {
      case 'numbers': {
        const tiles: [string, string][] = [[nf(st.totals.books), tn('share.books', st.totals.books)]];
        if (st.totals.pages) tiles.push([nf(st.totals.pages), t('wrap.pages')]);
        if (st.totals.minutes) tiles.push([nf(Math.round(st.totals.minutes / 60)), t('share.hours')]);
        if (st.totals.avgRating) tiles.push([st.totals.avgRating.toLocaleString(i18n.locale, { maximumFractionDigits: 1 }) + ' ★', t('wrap.stars')]);
        const tg = 22, tw = (w - tg * (tiles.length - 1)) / tiles.length;
        tiles.forEach(([v, l], i) => {
          const tx = x + i * (tw + tg);
          ctx.fillStyle = P.card; ctx.beginPath(); ctx.roundRect(tx, y, tw, h, 22); ctx.fill();
          ctx.fillStyle = P.text; ctx.font = `700 ${tiles.length > 3 ? 54 : 64}px ${font()}`;
          ctx.fillText(fit(ctx, v, tw - 40), tx + 26, y + 92);
          ctx.fillStyle = P.muted; ctx.font = `400 26px ${font()}`;
          ctx.fillText(fit(ctx, l, tw - 40), tx + 26, y + 138);
        });
        break;
      }
      case 'covers': {
        const ids = st.order ?? Object.keys(st.books).map(Number);
        const books = ids.map(id => st.books[id]).filter(Boolean);
        // Spaltenzahl so wählen, dass möglichst alle Cover in den Bereich passen (2:3), höchstens 8 Spalten
        let best = { cols: 3, cw: 0, rows: 1, shown: 0 };
        for (let cols = 2; cols <= 8; cols++) {
          const g = 18, cw = (w - g * (cols - 1)) / cols, ch = cw * 1.5;
          const rows = Math.max(1, Math.floor((h + g) / (ch + g)));
          const shown = Math.min(books.length, rows * cols);
          if (shown > best.shown || (shown === best.shown && cw > best.cw)) best = { cols, cw, rows, shown };
          if (shown >= books.length) break;
        }
        const g = 18, cw = best.cw, ch = cw * 1.5;
        const list = books.slice(0, best.shown);
        const more = books.length - list.length;
        const imgs = await Promise.all(list.map(bk => loadImg(bk.coverUrl)));
        const rowsUsed = Math.ceil(list.length / best.cols);
        const oy = y + Math.max(0, (h - (rowsUsed * ch + (rowsUsed - 1) * g)) / 2);
        list.forEach((bk, i) => cover(ctx, P, imgs[i], bk, x + (i % best.cols) * (cw + g), oy + Math.floor(i / best.cols) * (ch + g), cw, ch));
        if (more > 0) {
          const i = list.length - 1, cx = x + (i % best.cols) * (cw + g), cy = oy + Math.floor(i / best.cols) * (ch + g);
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(cx, cy, cw, ch, cw / 30); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(cw / 4)}px ${font()}`; ctx.textAlign = 'center';
          ctx.fillText(`+${more + 1}`, cx + cw / 2, cy + ch / 2 + cw / 10); ctx.textAlign = 'left';
        }
        break;
      }
      case 'top': {
        const bk = st.highlights.top!;
        const cw = 230, ch = 345;
        cover(ctx, P, await loadImg(bk.coverUrl), bk, x, y + 10, cw, ch);
        const tx = x + cw + 44, tw = w - cw - 44;
        ctx.fillStyle = P.accent; ctx.font = `600 30px ${headFont()}`; ctx.fillText(t('share.best'), tx, y + 50);
        ctx.fillStyle = P.text; ctx.font = `700 46px ${font()}`;
        const n = wrap(ctx, bk.title, tx, y + 120, tw, 56, 3);
        ctx.fillStyle = P.muted; ctx.font = `400 30px ${font()}`;
        ctx.fillText(fit(ctx, bk.authors.join(', '), tw), tx, y + 120 + n * 56 + 8);
        if (st.highlights.topRating) {
          ctx.fillStyle = P.star; ctx.font = `400 48px ${font()}`;
          const full = Math.floor(st.highlights.topRating), half = st.highlights.topRating % 1 >= 0.5;
          ctx.fillText('★'.repeat(full) + (half ? '½' : ''), tx, y + 120 + n * 56 + 76);
        }
        break;
      }
      case 'genres': case 'authors': {
        const items = (b === 'genres' ? st.genres.slice(0, 4) : st.authors.slice(0, 3)) as StatGroup[];
        let yy = y + heading(ctx, P, b === 'genres' ? t('wrap.topGenres') : t('wrap.topAuthors'), x, y);
        const max = Math.max(...items.map(i => i.n));
        const rowH = b === 'genres' ? 54 : 48;
        for (const it of items) {
          if (b === 'genres') {
            const bw = Math.max(8, (w * 0.45) * (it.n / max));
            ctx.fillStyle = P.accent; ctx.beginPath(); ctx.roundRect(x + w - bw, yy + 8, bw, 26, 13); ctx.fill();
            ctx.fillStyle = P.text; ctx.font = `400 30px ${font()}`;
            ctx.fillText(fit(ctx, it.name, w * 0.5), x, yy + 32);
          } else {
            ctx.fillStyle = P.text; ctx.font = `400 32px ${font()}`;
            ctx.fillText(fit(ctx, it.name, w - 160), x, yy + 32);
            ctx.fillStyle = P.muted; ctx.textAlign = 'right'; ctx.fillText(`${nf(it.n)} ${tn('share.books', it.n)}`, x + w, yy + 32); ctx.textAlign = 'left';
          }
          yy += rowH;
        }
        break;
      }
      case 'moods': {
        let yy = y + heading(ctx, P, t('share.moods'), x, y), xx = x;
        ctx.font = `500 30px ${font()}`;
        st.moods.slice(0, 8).forEach((m, i) => {
          const txt = t(`mood.${m.name}` as Key), cw = ctx.measureText(txt).width + 56;
          if (xx + cw > x + w) { xx = x; yy += 66; }
          ctx.fillStyle = i === 0 ? P.accent : P.card; ctx.beginPath(); ctx.roundRect(xx, yy, cw, 52, 26); ctx.fill();
          ctx.fillStyle = i === 0 ? P.bg : P.text; ctx.fillText(txt, xx + 28, yy + 36);
          xx += cw + 14;
        });
        break;
      }
      case 'stars': {
        let yy = y + heading(ctx, P, t('share.ratings'), x, y);
        const byStar = [5, 4, 3, 2, 1].map(sv => st.ratings.filter(r => Math.ceil(r.rating) === sv).reduce((a, r) => a + r.n, 0));
        const max = Math.max(1, ...byStar);
        byStar.forEach((n, i) => {
          ctx.fillStyle = P.star; ctx.font = `400 28px ${font()}`; ctx.fillText('★'.repeat(5 - i), x, yy + 30);
          const bx = x + 190, bw = (w - 260) * (n / max);
          ctx.fillStyle = P.card; ctx.beginPath(); ctx.roundRect(bx, yy + 8, w - 260, 24, 12); ctx.fill();
          if (n) { ctx.fillStyle = P.accent; ctx.beginPath(); ctx.roundRect(bx, yy + 8, Math.max(24, bw), 24, 12); ctx.fill(); }
          ctx.fillStyle = P.muted; ctx.textAlign = 'right'; ctx.fillText(String(n), x + w, yy + 30); ctx.textAlign = 'left';
          yy += 42;
        });
        break;
      }
      case 'facts': {
        let yy = y + heading(ctx, P, t('share.facts'), x, y);
        for (const [k, v] of facts(st)) {
          ctx.fillStyle = P.muted; ctx.font = `400 28px ${font()}`; ctx.fillText(k, x, yy + 30);
          ctx.fillStyle = P.text; ctx.font = `600 30px ${font()}`; ctx.textAlign = 'right';
          ctx.fillText(fit(ctx, v, w * 0.6), x + w, yy + 30); ctx.textAlign = 'left';
          yy += 48;
        }
        break;
      }
    }
  }

  const fileName = () => `bookshelv-${period}.png`;
  function save() {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function share() {
    if (!blob) return;
    const file = new File([blob], fileName(), { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: titleFor(period) }).catch(() => {});
    else save();
  }
</script>

<section class="share">
  <a href="/stats" class="back"><Icon name="back" size={16} /> {t('stats.title')}</a>
  <h1>{t('share.title')}</h1>

  <div class="layout">
    <div class="preview">
      <canvas bind:this={canvas} class={format} aria-label={titleFor(period)}></canvas>
      {#if dropped.length}<p class="muted small">{t('share.dropped', { list: dropped.map(b => t(`share.block.${b}` as Key)).join(', ') })}</p>{/if}
      <div class="row acts">
        <button class="primary" onclick={share} disabled={!s}><Icon name="link" size={16} /> {t('wrap.share')}</button>
        <button onclick={save} disabled={!s}><Icon name="download" size={16} /> {t('wrap.save')}</button>
      </div>
    </div>

    <div class="controls stack">
      <div class="group">
        <span class="lbl">{t('share.period')}</span>
        <div class="segmented">
          {#each ['month', 'quarter', 'year'] as const as k}<button class:active={kind === k} onclick={() => setKind(k)}>{t(`share.kind.${k}` as Key)}</button>{/each}
        </div>
        <select bind:value={period} aria-label={t('share.period')}>
          {#each options as o (o)}<option value={o}>{label(o)}</option>{/each}
        </select>
      </div>

      <div class="group">
        <span class="lbl">{t('share.template')}</span>
        <div class="chips">
          {#each Object.keys(TEMPLATES) as id (id)}<button class="chip" class:on={template === id} onclick={() => pickTemplate(id)}>{t(`share.tpl.${id}` as Key)}</button>{/each}
          {#if template === 'custom'}<span class="chip on">{t('share.tpl.custom')}</span>{/if}
        </div>
      </div>

      <div class="group">
        <span class="lbl">{t('share.blocks')}</span>
        <div class="chips">
          {#each BLOCKS as b (b)}<button class="chip" class:on={blocks.includes(b)} aria-pressed={blocks.includes(b)} onclick={() => toggle(b)}>
            {#if blocks.includes(b)}<Icon name="check" size={12} />{/if} {t(`share.block.${b}` as Key)}</button>{/each}
        </div>
        <p class="muted small">{t('share.orderHint')}</p>
      </div>

      <div class="group">
        <span class="lbl">{t('share.format')}</span>
        <div class="segmented">
          {#each ['story', 'post', 'square'] as const as f}<button class:active={format === f} onclick={() => (format = f)}>{t(`share.fmt.${f}` as Key)}</button>{/each}
        </div>
      </div>

      <div class="group">
        <span class="lbl">{t('share.colors')}</span>
        <div class="swatches">
          {#each Object.entries(PALETTES) as [id, p] (id)}
            <button class="sw" class:on={palette === id} style="background: {p.bg}; --a: {p.accent}" onclick={() => (palette = id)} aria-label={t(`share.pal.${id}` as Key)} title={t(`share.pal.${id}` as Key)}><span></span></button>
          {/each}
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .share { display: grid; gap: 1rem; }
  .back { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--muted); }
  h1 { margin: 0; }
  .layout { display: grid; gap: 1.2rem; }
  @media (min-width: 900px) { .layout { grid-template-columns: minmax(0, 420px) minmax(0, 1fr); align-items: start; } .preview { position: sticky; top: 5rem; } }
  .preview { display: grid; gap: 0.6rem; justify-items: center; }
  canvas { width: 100%; max-width: 420px; height: auto; border-radius: var(--radius); box-shadow: var(--shadow); background: #121516; }
  canvas.story { aspect-ratio: 1080 / 1920; max-width: min(420px, 60vh * 0.5625); }
  canvas.post { aspect-ratio: 1080 / 1350; }
  canvas.square { aspect-ratio: 1; }
  .acts { gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
  .group { display: grid; gap: 0.45rem; }
  .lbl { font-size: 0.85rem; color: var(--muted); font-weight: 500; }
  .segmented { justify-self: start; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem; }
  .chip.on { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
  .swatches { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  .sw { width: 44px; height: 44px; border-radius: 50%; padding: 0; border: 2px solid var(--line); display: grid; place-items: center; }
  .sw span { width: 16px; height: 16px; border-radius: 50%; background: var(--a); }
  .sw.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
  select { justify-self: start; min-width: 12rem; }
</style>
