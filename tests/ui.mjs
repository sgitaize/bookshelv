// Browser-Tests für Bedienung: Scrollposition beim Zurückgehen. Läuft gegen die Testinstanz auf 3999.
import puppeteer from 'puppeteer-core';
const base = 'http://localhost:3999';
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? ok++ : (fail++, console.log('✗', n, x)); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium'), args: ['--no-sandbox'], headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(base + '/', { waitUntil: 'networkidle0' });
await page.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'simon', password: 'geheim1234' }) }));

// Bibliothek: runterscrollen, Buch öffnen, zurück → gleiche Stelle
await page.goto(base + '/library', { waitUntil: 'networkidle0' });
await page.evaluate(() => scrollTo(0, 900));
await new Promise(r => setTimeout(r, 200));
const y0 = await page.evaluate(() => scrollY);
const link = await page.evaluateHandle(() => [...document.querySelectorAll('a[href^="/book/"]')].find(a => a.getBoundingClientRect().top > 100));
await link.click();
await page.waitForFunction(() => location.pathname.startsWith('/book/'));
await new Promise(r => setTimeout(r, 500));
check('book opens at top', (await page.evaluate(() => scrollY)) < 5);
await page.goBack();
await new Promise(r => setTimeout(r, 1200));
const y1 = await page.evaluate(() => scrollY);
check('scroll restored after back', y0 > 300 && Math.abs(y1 - y0) < 5, `${y0} → ${y1}`);

await browser.close();
console.log(`UI-Test: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
