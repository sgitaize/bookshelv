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

// Leihanfrage über die Oberfläche: Anna fragt auf der Buchseite an, Simon nimmt unter Verleih → Anfragen an
const ctxA = await browser.createBrowserContext();
const pa = await ctxA.newPage();
await pa.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await pa.goto(base + '/', { waitUntil: 'networkidle0' });
await pa.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'anna', password: 'geheim1234' }) }));
const target = await page.evaluate(() => fetch('/api/copies').then(r => r.json()).then(cs => cs.find(c => !c.lent && c.format === 'print')));
await pa.goto(base + `/book/${target.book.id}`, { waitUntil: 'networkidle0' });
const askBtn = await pa.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /Ausleihen anfragen|Ask to borrow/.test(b.textContent)));
check('ask button on friend copy', !!(await askBtn.evaluate(b => !!b)));
await askBtn.click();
await pa.type('.ask input', 'Bitte bis Sonntag');
await (await pa.evaluateHandle(() => [...document.querySelectorAll('.ask button')][0])).click();
await pa.waitForFunction(() => [...document.querySelectorAll('.chip')].some(c => /Angefragt|Requested/.test(c.textContent)), { timeout: 5000 }).catch(() => {});
check('request shown as pending', await pa.evaluate(() => [...document.querySelectorAll('.chip')].some(c => /Angefragt|Requested/.test(c.textContent))));
await page.goto(base + '/loans?tab=requests', { waitUntil: 'networkidle0' });
check('incoming request listed', await page.evaluate(() => document.body.innerText.includes('Bitte bis Sonntag')));
if (process.env.SHOTDIR) await page.screenshot({ path: `${process.env.SHOTDIR}/ui-requests.png` });
await (await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /Annehmen|Accept/.test(b.textContent)))).click();
await (await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /^\s*(Verleihen|Lend)\s*$/.test(b.textContent)))).click();
await page.waitForFunction(() => !document.body.innerText.includes('Bitte bis Sonntag'), { timeout: 5000 }).catch(() => {});
const borrowed = await pa.evaluate(() => fetch('/api/loans').then(r => r.json()));
const ln = borrowed.borrowed.find(l => l.book.id === target.book.id);
check('accepted via UI → loan', !!ln);
if (ln) await page.evaluate(id => fetch(`/api/loans/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' }), ln.id);
await ctxA.close();

// Leserunde (aus reads.mjs): Simon sieht verdeckte Beiträge ohne Text
const rid = (await page.evaluate(() => fetch('/api/reads').then(r => r.json())))[0]?.id;
await page.goto(base + `/reads/${rid}`, { waitUntil: 'networkidle0' });
const rd = await page.evaluate(() => ({ locked: document.querySelectorAll('.post.locked').length, txt: document.body.innerText }));
check('buddy read shows locked posts', rd.locked >= 1 && !rd.txt.includes('Das Ende hat mich umgehauen'), JSON.stringify(rd.locked));
if (process.env.SHOTDIR) await page.screenshot({ path: `${process.env.SHOTDIR}/ui-read.png`, fullPage: true });

await browser.close();
console.log(`UI-Test: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
