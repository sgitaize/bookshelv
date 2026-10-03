// Offline-Modus (Grundlage): App startet ohne Netz aus dem Service-Worker-Cache, Scans werden gemerkt
// und später fertiggestellt (Wunschliste). Läuft gegen die Testinstanz auf 3999 (Chromium nötig).
import puppeteer from 'puppeteer-core';
const base = 'http://localhost:3999';
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? ok++ : (fail++, console.log('✗', n, x)); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium'), args: ['--no-sandbox'], headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'simon', password: 'geheim1234' }) }));
await page.goto(base + '/add', { waitUntil: 'networkidle0' });
// Service Worker aktiv und App-Hülle im Cache
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 4000)); // warmOfflineCache läuft nach 3 s
const me = await page.evaluate(() => JSON.parse(localStorage.getItem('bookshelv-me') ?? 'null'));
check('me cached', me?.username === 'simon');

await page.setOfflineMode(true);
await page.goto(base + '/add', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForSelector('.offbar', { timeout: 8000 }).catch(() => {});
check('app starts offline', !!(await page.$('.offbar')) && !!(await page.$('.target')), await page.evaluate(() => document.body.innerText.slice(0, 200)));
// Scan simulieren: was onScan offline tut (ISBN in die Warteschlange)
await page.evaluate(id => {
  localStorage.setItem(`bookshelv-scans-${id}`, JSON.stringify([{ isbn: '9783847901846', target: 'wishlist', at: new Date().toISOString() }]));
}, me.id);
await page.setOfflineMode(false);
await page.goto(base + '/add', { waitUntil: 'networkidle0' });
check('pending shown online', !!(await page.$('.ps')));
await page.click('.ps .primary');
await page.waitForFunction(() => document.querySelector('.ps .primary')?.textContent?.match(/übernehmen|Accept/i), { timeout: 30000 }).catch(() => {});
await page.click('.ps .primary');
await page.waitForFunction(() => !document.querySelector('.ps'), { timeout: 15000 }).catch(() => {});
const wish = await page.evaluate(() => fetch('/api/wishlist').then(r => r.json()));
check('offline scan completed to wishlist', wish.some(w => w.book.isbn13 === '9783847901846' || /Babel/.test(w.book.title)), JSON.stringify(wish.map(w => w.book.title)));
check('queue emptied', (await page.evaluate(id => JSON.parse(localStorage.getItem(`bookshelv-scans-${id}`) ?? '[]').length, me.id)) === 0);
await browser.close();
console.log(`Offline-Test: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) process.exitCode = 1;
