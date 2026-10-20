/* App-Store-Bilder aus echten Seiten: Wegwerf-Instanz aus dist/ mit Demo-Bibliothek (demo-books.json, Mara + drei
   Freund*innen), Seiten in Chrome wie in der App (window.bookshelvApp), daraus die Store-Motive mit Überschrift.
   Voraussetzung: npm run build (im Repo-Hauptordner); Internet (Buchdaten + Cover kommen von DNB/Open Library).
   Nutzung:  node docs/store/storeshots.mjs            (CHROME=<pfad> für einen anderen Browser)
   Ergebnis: docs/store/screenshots/<de|en>/<iphone|ipad>/0N-<szene>.jpg  (iPhone 6,9″ 1320×2868, iPad 13″ 2064×2752)
             docs/store/screenshots/android/<de|en>/… (1080×2340, für die Download-Seite) */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUT = path.join(HERE, 'screenshots');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 3988, URL0 = `http://127.0.0.1:${PORT}`, DBG = 9341;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEVICES = [
  { name: 'iphone', w: 440, h: 956, dsf: 3, platform: 'ios' },        // 1320 × 2868
  { name: 'ipad', w: 768, h: 1024, dsf: 2.6875, platform: 'ios' },     // 2064 × 2752
  { name: 'android', w: 360, h: 780, dsf: 3, platform: 'android' },   // 1080 × 2340
  { name: 'play', w: 360, h: 640, dsf: 3, platform: 'android' },      // 1080 × 1920 (Google Play: höchstens 2:1)
  { name: 'play-tablet', w: 720, h: 1280, dsf: 1.5, platform: 'android' } // 1080 × 1920 (Play 10″-Tablet: nur 9:16)
];

/* Reihenfolge = Reihenfolge im Store */
const SCENES = [
  { id: 'home', path: '/',
    de: ['Deine Bücher.<br>Gelesen, geliehen, geliebt.', 'Ohne Konto und ohne Werbung – deine Bibliothek liegt auf deinem Gerät.'],
    en: ['Your books.<br>Read, lent, loved.', 'No account, no ads – your library lives on your device.'] },
  { id: 'library', path: '/library',
    de: ['Dein ganzes Regal', 'Gedruckt, E-Book oder Hörbuch – mit Covern, Filtern und Suche.'],
    en: ['Your whole shelf', 'Print, e-book or audiobook – with covers, filters and search.'] },
  { id: 'add', path: '/add?tab=search', search: 'Harry Potter',
    de: ['Scannen und fertig', 'ISBN scannen oder suchen: Buchdaten und Cover kommen von der Nationalbibliothek.'],
    en: ['Scan and done', 'Scan the ISBN or search: details and covers come from national library catalogues.'] },
  { id: 'book', path: '/book/18', scroll: '.reading', offset: 220,
    de: ['Bewerten mit halben Sternen', 'Stimmungen, Tempo, Lesedaten – und was deine Freund*innen sagen.'],
    en: ['Rate with half stars', 'Moods, pace, reading dates – and what your friends think.'] },
  { id: 'stats', path: '/stats',
    de: ['Dein Lesejahr in Zahlen', 'Statistik, Stimmungskurve und Jahresrückblick zum Teilen.'],
    en: ['Your reading year in numbers', 'Stats, mood curve and a year in review to share.'] },
  { id: 'loans', path: '/loans',
    de: ['Wer hat eigentlich …?', 'Verleih mit Rückgabedatum – überfällige Bücher fallen sofort auf.'],
    en: ['Who has my …?', 'Lending with due dates – overdue books stand out right away.'] },
  { id: 'profile', path: '/me',
    de: ['Favoriten im Regal', 'Profil mit Top 5, Leselisten und allem, was du gerade liest.'],
    en: ['Favourites on the shelf', 'Your profile with top 5, reading lists and current reads.'] },
  { id: 'friends', path: '/feed',
    de: ['Lesen mit Freund*innen', 'Mit Konto: Feed, Leihanfragen und Leserunden. Kein Tracking.'],
    en: ['Read with friends', 'With an account: feed, loan requests and buddy reads. No tracking.'] }
];

// ---------- Wegwerf-Instanz mit Demo-Daten ----------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-store-'));
if (!fs.existsSync(path.join(ROOT, 'dist/server.js'))) throw new Error('Erst bauen: npm run build');
fs.cpSync(path.join(ROOT, 'dist'), TMP, { recursive: true, filter: s => !s.includes(`${path.sep}data`) });
let srv, chrome;

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const json = method !== 'GET';
    const res = await fetch(`${URL0}/api${url}`, { method, headers: { ...(json ? { 'Content-Type': 'application/json', Origin: URL0 } : {}), cookie }, body: json ? JSON.stringify(body ?? {}) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await res.json(); } catch { /* leer */ }
    if (res.status >= 400) console.warn('!', method, url, res.status, JSON.stringify(data).slice(0, 160));
    return { status: res.status, data };
  };
}

async function seed() {
  const me = client(), cl = { jonas: client(), aylin: client(), ben: client() };
  const token = fs.readFileSync(path.join(TMP, 'data/setup-token.txt'), 'utf8').trim();
  await me('POST', '/setup', { token, username: 'mara', displayName: 'Mara', password: 'geheim1234' });
  for (const u of Object.keys(cl)) {
    const inv = await me('POST', '/invites', { note: u });
    await cl[u]('POST', '/register', { token: inv.data.token, username: u, displayName: u[0].toUpperCase() + u.slice(1), password: 'geheim1234' });
  }
  const ids = {};
  for (const w of JSON.parse(fs.readFileSync(path.join(HERE, 'demo-books.json'), 'utf8'))) {
    let r = await me('POST', '/catalog/isbn', { isbn: w.isbn });
    for (let i = 0; i < 3 && !r.data?.book; i++) { await sleep(3000); r = await me('POST', '/catalog/isbn', { isbn: w.isbn }); }
    const b = r.data?.book;
    if (!b) { console.warn('nicht gefunden:', w.key, w.isbn); continue; }
    if (!b.coverUrl) console.warn('ohne Cover:', w.key, b.title);
    ids[w.key] = b.id;
    if (w.own !== false) await me('POST', '/copies', { bookId: b.id, format: w.format || 'print', binding: w.binding || 'paperback' });
    if (w.wish) await me('PUT', `/books/${b.id}/wishlist`, { note: 'Nach der Mitternachtsbibliothek' });
    if (w.status) await me('PUT', `/books/${b.id}/reading`, { status: w.status, progress: w.progress, startedAt: w.started, finishedAt: w.finished, favorite: !!w.fav });
    if (w.rating) await me('PUT', `/books/${b.id}/review`, { rating: w.rating, text: w.text || '', visibility: 'instance', moods: w.moods || [], pace: w.pace || null });
    for (const u of Object.keys(cl)) {
      const f = w[u]; if (!f) continue;
      if (f.own) await cl[u]('POST', '/copies', { bookId: b.id, format: 'print', binding: 'hardcover' });
      if (f.status) await cl[u]('PUT', `/books/${b.id}/reading`, { status: f.status, finishedAt: f.finished, progress: f.progress });
      if (f.rating) await cl[u]('PUT', `/books/${b.id}/review`, { rating: f.rating, text: f.text || '', visibility: 'instance', moods: f.moods || [], pace: f.pace || null });
    }
  }
  await me('PUT', '/me/top', { bookIds: ['herkunft', 'hobbit', 'unterleuten', 'tschick', 'stolz'].map(k => ids[k]).filter(Boolean) });
  const lists = [['Sommer an der Ostsee', 'Leichtes für den Strandkorb', ['altesland', 'mittagsstunde', 'tschick', 'prinz']],
    ['Klassiker, die ich endlich lese', null, ['zauberberg', 'buddenbrooks', 'steppenwolf', 'rose']]];
  for (const [name, description, keys] of lists) {
    const id = (await me('POST', '/lists', { name, description })).data.id;
    for (const k of keys) await me('PUT', `/lists/${id}/books/${ids[k]}`, {});
  }
  const users = (await me('GET', '/users')).data;
  const uid = n => (users.users || users).find(u => u.username === n)?.id;
  const copies = (await me('GET', '/copies')).data;
  const copyOf = k => (copies.copies || copies.items || copies).find(c => (c.book?.id ?? c.bookId) === ids[k])?.id;
  await me('POST', `/copies/${copyOf('hobbit')}/loans`, { borrowerId: uid('jonas'), lentAt: '2026-09-20', dueAt: '2026-10-31' });
  await me('POST', `/copies/${copyOf('unterleuten')}/loans`, { borrowerId: uid('aylin'), lentAt: '2026-08-02', dueAt: '2026-10-01' });
  await me('POST', `/copies/${copyOf('potter')}/loans`, { borrowerName: 'Oma Gisela', lentAt: '2026-10-05' });
  // feste Buch-ID für die Detailseite (Herkunft)
  SCENES.find(s => s.id === 'book').path = `/book/${ids.herkunft}`;
}

// ---------- Chrome ----------

async function connect() {
  chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${DBG}`, `--user-data-dir=${path.join(TMP, 'chr')}`, 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 50 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } });
  return (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
}

async function capture(send, dev, lang, raw) {
  const js = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Emulation.setDeviceMetricsOverride', { width: dev.w, height: dev.h - STATUS(dev), deviceScaleFactor: dev.dsf, mobile: dev.w < 600 });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: URL0 + '/' }); await sleep(1200);
  await js(`localStorage.clear();localStorage.setItem('bookshelv-lang','${lang}');fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mara',password:'geheim1234'})}).then(r=>r.status)`);
  for (const sc of SCENES) {
    await send('Page.navigate', { url: URL0 + sc.path }); await sleep(3000);
    if (sc.search) {
      await js(`(function(){var i=document.querySelector('input[type=search]');i.value=${JSON.stringify(sc.search)};i.dispatchEvent(new Event('input',{bubbles:true}));i.form.requestSubmit();return 1})()`);
      await sleep(6000);
    }
    if (sc.scroll) await js(`(function(){var e=document.querySelector(${JSON.stringify(sc.scroll)});if(e)window.scrollTo(0,e.getBoundingClientRect().bottom+scrollY-${sc.offset || 0});return 1})()`);
    await js('document.activeElement&&document.activeElement.blur();1');
    await sleep(900);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(raw, `${dev.name}-${lang}-${sc.id}.png`), Buffer.from(r.result.data, 'base64'));
    console.log('roh', dev.name, lang, sc.id);
  }
}

// ---------- Store-Motiv ----------

/** Höhe der nachgebauten Statusleiste (CSS-Pixel) */
const STATUS = dev => dev.name === 'ipad' ? 24 : dev.platform === 'android' ? 28 : 54;
const SPINES = ['#e8a54b', '#c8553d', '#5b8c85', '#f3ece0', '#5fb0b3'];

function statusBar(dev, lang) {
  const h = STATUS(dev), ipad = dev.name === 'ipad', android = dev.platform === 'android';
  const time = android ? '9:41' : '9:41';
  const pad = ipad ? '0 22px' : android ? '0 18px' : '0 34px 0 46px';
  const fs = ipad ? 13 : android ? 13 : 17;
  const icons = `<svg width="${ipad ? 62 : 72}" height="${fs}" viewBox="0 0 72 14" fill="#f2f2f2">` +
    '<rect x="0" y="9" width="3" height="5" rx="1"/><rect x="5" y="6" width="3" height="8" rx="1"/><rect x="10" y="3" width="3" height="11" rx="1"/><rect x="15" y="0" width="3" height="14" rx="1"/>' +
    '<path d="M31 4.5a10 10 0 0 1 14 0l-1.6 1.6a7.7 7.7 0 0 0-10.8 0zM34.2 7.7a5.5 5.5 0 0 1 7.6 0L38 11.5z"/>' +
    '<rect x="50" y="1.5" width="19" height="11" rx="3" fill="none" stroke="#f2f2f2" stroke-opacity=".5"/><rect x="52" y="3.5" width="14" height="7" rx="1.5"/><rect x="70" y="5" width="1.6" height="4" rx=".8" fill-opacity=".5"/></svg>';
  return `<div class="sb" style="height:${h}px;padding:${pad};font-size:${fs}px">` +
    `<span>${time}</span>${ipad ? `<span class="ipdate">${lang === 'de' ? 'Do. 15. Okt.' : 'Thu Oct 15'}</span>` : ''}${android ? '' : ''}<span class="ic">${icons}</span></div>`;
}

function composeHtml(dev, sc, lang, img, i) {
  const phone = dev.w < 600, ipad = dev.name === 'ipad';
  const [title, sub] = sc[lang];
  const accent = SPINES[i % SPINES.length];
  const font = f => `url(data:font/woff2;base64,${fs.readFileSync(path.join(TMP, 'public/assets', fs.readdirSync(path.join(TMP, 'public/assets')).find(n => n.startsWith(f)))).toString('base64')})`;
  const devW = ipad ? 0.8 : 0.84;
  const radius = ipad ? 30 : dev.platform === 'android' ? 30 : 52;
  const short = dev.name === 'play';
  return `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:SE;src:${font('special-elite-latin-400')}}
    @font-face{font-family:SE;src:${font('special-elite-latin-ext-400')};unicode-range:U+0100-024F}
    @font-face{font-family:CP;src:${font('courier-prime-latin-400-normal')}}
    @font-face{font-family:CP;font-weight:700;src:${font('courier-prime-latin-700-normal')}}
    html,body{margin:0;width:${dev.w}px;height:${dev.h}px;overflow:hidden}
    body{background:radial-gradient(ellipse 120% 70% at 50% 0%,#21282a 0%,#161a1b 55%,#0f1213 100%);color:#f3ece0;position:relative;font-family:CP,Courier,monospace}
    body:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 85% 8%,${accent}22,transparent 45%);pointer-events:none}
    .head{position:absolute;left:0;right:0;top:${short ? 28 : phone ? 46 : 64}px;text-align:center;padding:0 ${phone ? 26 : 70}px}
    .spines{display:flex;justify-content:center;align-items:flex-end;gap:${phone ? 4 : 6}px;margin-bottom:${short ? 10 : phone ? 16 : 22}px}
    .spines i{display:block;width:${phone ? 9 : 13}px;border-radius:2px}
    h1{font-family:SE,serif;font-weight:400;font-size:${short ? (title.length > 34 ? 26 : 29) : phone ? (title.length > 34 ? 31 : 36) : 38}px;line-height:1.12;margin:0 0 ${short ? 8 : phone ? 12 : 18}px;letter-spacing:-.01em;color:#fbf6ec}
    p{font-size:${short ? 14 : phone ? 17 : 19}px;line-height:1.38;margin:0 auto;max-width:${phone ? 380 : 720}px;color:rgba(243,236,224,.78)}
    .dev{position:absolute;left:50%;transform:translateX(-50%);top:${short ? (title.includes('<br>') ? 212 : 186) : phone ? (title.includes('<br>') ? 292 : 262) : (title.includes('<br>') ? 304 : 252)}px;width:${devW * 100}%;
      border-radius:${radius}px;overflow:hidden;border:${phone ? 8 : 12}px solid #050606;background:#121516;
      box-shadow:0 34px 70px rgba(0,0,0,.55),0 0 0 2px rgba(255,255,255,.07),0 0 0 1px ${accent}55 inset}
    .sb{display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;background:#121516;color:#f2f2f2;font-family:-apple-system,"SF Pro Text",Roboto,system-ui,sans-serif;font-weight:600}
    .sb .ipdate{flex:1;margin-left:8px;font-weight:500}
    .dev img{display:block;width:100%}
    </style><body><div class="head"><div class="spines">${[34, 46, 38, 52, 30].map((h, k) => `<i style="height:${short ? h * .5 : phone ? h * .7 : h}px;background:${SPINES[(k + i) % 5]}"></i>`).join('')}</div>
    <h1>${title}</h1><p>${sub}</p></div>
    <div class="dev">${statusBar(dev, lang)}<img src="data:image/png;base64,${img.toString('base64')}"></div></body>`;
}

// ---------- Ablauf ----------

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { chrome?.kill('SIGKILL'); srv?.kill('SIGKILL'); process.exit(1); });
(async () => {
  srv = spawn(process.execPath, ['server.js'], { cwd: TMP, env: { ...process.env, PORT: String(PORT), BOOKSHELV_INSECURE_COOKIES: '1', NODE_NO_WARNINGS: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { await sleep(250); try { if ((await fetch(`${URL0}/api/status`)).ok) break; } catch { /* startet noch */ } }
  console.log('Demo-Bibliothek anlegen …');
  await seed();
  const send = await connect();
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] });
  const raw = path.join(TMP, 'raw'); fs.mkdirSync(raw);
  const only = process.env.ONLY?.split(',');
  const devices = DEVICES.filter(d => !only || only.includes(d.name));
  for (const dev of devices) {
    const info = { platform: dev.platform, mode: 'remote', instance: 'https://bookshelv.aize-it.de', version: '1.0.0', scanner: true };
    const { result } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.bookshelvApp=${JSON.stringify(info)};` });
    for (const lang of ['de', 'en']) await capture(send, dev, lang, raw);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: result.identifier });
  }
  for (const dev of devices) {
    await send('Emulation.setDeviceMetricsOverride', { width: dev.w, height: dev.h, deviceScaleFactor: dev.dsf, mobile: false });
    for (const lang of ['de', 'en']) {
      const dir = dev.platform === 'android' ? path.join(OUT, dev.name, lang) : path.join(OUT, lang, dev.name);
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < SCENES.length; i++) {
        const sc = SCENES[i], html = path.join(TMP, 'c.html');
        fs.writeFileSync(html, composeHtml(dev, sc, lang, fs.readFileSync(path.join(raw, `${dev.name}-${lang}-${sc.id}.png`)), i));
        await send('Page.navigate', { url: `file://${html}` }); await sleep(900);
        const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
        const f = path.join(dir, `0${i + 1}-${sc.id}.jpg`);
        fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
        console.log(path.relative(ROOT, f));
      }
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => {
    chrome?.kill('SIGKILL'); srv?.kill('SIGKILL');
    setTimeout(() => { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }); process.exit(process.exitCode || 0); }, 600);
  });
