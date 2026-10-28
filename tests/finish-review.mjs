// Fertig gelesen → Bewerten-Fenster geht sofort auf (wie bei Booky); abgebrochen → Datum abfragen.
// Läuft gegen die Testinstanz auf 3999 (Chromium nötig), nach offline.mjs.
import puppeteer from 'puppeteer-core';
const base = 'http://localhost:3999';
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? ok++ : (fail++, console.log('✗', n, x)); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium'), args: ['--no-sandbox'], headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'simon', password: 'geheim1234' }) }));
const setStatus = status => page.evaluate(s => fetch('/api/books/1/reading', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: s }) }), status);
const dialog = () => page.waitForSelector('[role=dialog]', { timeout: 5000 }).then(() => page.$eval('[role=dialog]', d => d.getAttribute('aria-label'))).catch(() => null);
// Status-Knöpfe auf der Buchseite: unread, reading, read, dnf
const statusButton = i => page.$$eval('.card.reading .segmented button', (bs, i) => bs[i].click(), i);

await setStatus('reading');
await page.goto(base + '/book/1', { waitUntil: 'networkidle0' });
await statusButton(2);
check('book page: read opens review', (await dialog()) === 'Bewerten');
const rd = await page.evaluate(() => fetch('/api/books/1').then(r => r.json()));
check('finished date set to today', rd.reading?.finishedAt === new Date().toISOString().slice(0, 10), JSON.stringify(rd.reading));

await setStatus('reading');
await page.goto(base + '/book/1', { waitUntil: 'networkidle0' });
await statusButton(3);
check('book page: dnf asks for date', (await dialog()) === 'Wann hast du abgebrochen?');

await setStatus('reading');
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.$eval('button.bar', b => b.click());
await page.waitForSelector('[role=dialog] button.dark');
await page.$eval('[role=dialog] button.dark', b => b.click());
await page.waitForFunction(() => document.querySelector('[role=dialog]')?.getAttribute('aria-label') === 'Bewerten', { timeout: 5000 }).catch(() => {});
check('home: finished opens review', (await page.$eval('[role=dialog]', d => d.getAttribute('aria-label')).catch(() => null)) === 'Bewerten');

await browser.close();
console.log(`Fertig-Bewerten-Test: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) process.exitCode = 1;
