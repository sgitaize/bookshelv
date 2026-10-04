// Prüft jede Seite auf horizontalen Überlauf und meldet die breitesten Übeltäter
import puppeteer from 'puppeteer-core';
const D = process.argv[2], base = 'http://localhost:3999';
const shotsFor = (process.argv[3] ?? '').split(',').filter(Boolean);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium'), args: ['--no-sandbox'], headless: 'new' });
const page = await browser.newPage();
if (process.env.LANG_EN) await page.evaluateOnNewDocument(() => localStorage.setItem('bookshelv-lang', 'en'));
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(base, { waitUntil: 'networkidle0' });
const inputs = await page.$$('input');
await inputs[0].type('simon'); await inputs[1].type('geheim1234');
await page.click('button.primary'); await page.waitForNetworkIdle();
const pages = ['/', '/library', '/book/1', '/loans?tab=requests', '/reads', '/reads/1', '/authors', '/series', '/series?name=Testreihe%20der%20W%C3%A4chter', '/add?tab=scan', '/add?tab=search&q=dune', '/add?tab=manual', '/people', '/people/2', '/people/2/shelf', '/me', '/settings', '/settings?s=profile', '/settings?s=privacy', '/settings?s=appearance', '/settings?s=invites', '/settings?s=data', '/settings?s=account', '/admin', '/loans', '/history', '/notifications', '/feed', '/wishlist', '/import', '/stats', '/stats?year=2024', '/wrapup?year=2024', '/lists', '/lists/1', '/feed?scope=me', '/feed?user=1', '/imports', '/legal'];
// ONLY=/settings,/stats → nur diese Seiten (schneller Check nach kleinen Änderungen)
const only = (process.env.ONLY ?? '').split(',').filter(Boolean);
const todo = only.length ? pages.filter(p => only.some(o => p === o || p.startsWith(o + '?') || p.startsWith(o + '/'))) : pages;
const lang = process.env.LANG_EN ? 'EN' : 'DE';
// Seite einmal je Gruppe laden, dann nur die Breite ändern (isMobile-Wechsel würde neu laden → Gruppen)
const groups = [[[320, 568], [375, 667], [390, 844], [768, 1024], [820, 1180]], [[1024, 768], [1440, 900], [1920, 1080]]];
let problems = 0;
const audit = () => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const sw = document.documentElement.scrollWidth;
  const bad = [];
  // in horizontal scrollbaren Containern (Buchreihen) ist Überstand gewollt; Ergebnis je Element zwischenspeichern
  const clipped = new Map();
  const inScroller = el => {
    if (!el) return false;
    if (clipped.has(el)) return clipped.get(el);
    const ox = getComputedStyle(el).overflowX;
    const v = ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip' || inScroller(el.parentElement);
    clipped.set(el, v);
    return v;
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el.parentElement)) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(r.left)}–${Math.round(r.right)}]`);
  }
  const small = [...document.querySelectorAll('input, select, textarea')].filter(i => parseFloat(getComputedStyle(i).fontSize) < 16).length;
  return { vw, sw, bad: bad.slice(0, 4), small };
});
for (const [gi, sizes] of groups.entries()) {
  const mobile = gi === 0;
  for (const p of todo) {
    const [w0, h0] = sizes[0];
    await page.setViewport({ width: w0, height: h0, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    await page.goto(base + p, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, p.includes('dune') ? 3500 : 250));
    for (const [w, h] of sizes) {
      if (w !== w0) {
        await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      }
      const res = await audit();
      const issue = res.sw > res.vw || res.bad.length || (mobile && res.small);
      if (issue) { problems++; console.log(`[${lang}] ${w}x${h} ${p}: scrollWidth ${res.sw}/${res.vw}${res.small && mobile ? `, ${res.small} Eingabefelder <16px (iOS-Zoom)` : ''}`, res.bad.join(' | ')); }
      if (shotsFor.includes(`${w}${p}`)) await page.screenshot({ path: `${D}/shot-${w}${p.replace(/[/?=&]/g, '_')}.png` });
    }
  }
}
console.log(`[${lang}] Überlauf-Audit (${todo.length} Seiten × 8 Breiten): ${problems ? `${problems} Probleme` : 'keine Überläufe'}`);
await browser.close();
