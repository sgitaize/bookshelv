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
const pages = ['/', '/library', '/book/1', '/add?tab=scan', '/add?tab=search&q=dune', '/add?tab=manual', '/people', '/people/2', '/people/2/shelf', '/me', '/settings', '/admin', '/loans', '/history', '/notifications', '/feed', '/admin', '/wishlist', '/import', '/stats', '/stats?year=2024', '/wrapup?year=2024', '/lists', '/lists/1', '/feed?scope=me', '/feed?user=1'];
const sizes = [[320, 568, true], [375, 667, true], [390, 844, true], [768, 1024, true], [820, 1180, true], [1024, 768, false], [1440, 900, false], [1920, 1080, false]];
let problems = 0;
for (const [w, h, mobile] of sizes) {
  await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  for (const p of pages) {
    await page.goto(base + p, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, p.includes('dune') ? 3500 : 300));
    const res = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      const bad = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        // in horizontal scrollbaren Containern (Buchreihen) ist Überstand gewollt
        let p = el.parentElement, scroller = false;
        while (p) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { scroller = true; break; } p = p.parentElement; }
        if (!scroller && (r.right > vw + 1 || r.left < -1)) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(r.left)}–${Math.round(r.right)}]`);
      }
      const small = [...document.querySelectorAll('input, select, textarea')].filter(i => parseFloat(getComputedStyle(i).fontSize) < 16).length;
      return { vw, sw, bad: bad.slice(0, 4), small };
    });
    const issue = res.sw > res.vw || res.bad.length || (mobile && res.small);
    if (issue) { problems++; console.log(`${w}x${h} ${p}: scrollWidth ${res.sw}/${res.vw}${res.small && mobile ? `, ${res.small} Eingabefelder <16px (iOS-Zoom)` : ''}`, res.bad.join(' | ')); }
    if (shotsFor.includes(`${w}${p}`)) await page.screenshot({ path: `${D}/shot-${w}${p.replace(/[/?=&]/g, '_')}.png` });
  }
}
console.log(problems ? `${problems} Probleme` : 'Keine Überläufe');
await browser.close();
