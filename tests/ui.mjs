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

// Teilen-Bild: jede Vorlage und jedes Format zeichnet ohne Fehler etwas aufs Canvas
const errs = [];
page.on('pageerror', e => errs.push(e.message));
const per = (await page.evaluate(() => fetch('/api/stats').then(r => r.json()))).years.at(-1);
await page.goto(base + `/share?period=${per}`, { waitUntil: 'networkidle0' });
const drawn = async () => { await new Promise(r => setTimeout(r, 900)); return page.evaluate(() => { const c = document.querySelector('canvas'); if (!c) return { w: 0, h: 0, body: location.pathname + ' ' + document.body.innerText.slice(0, 300) }; const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return { w: c.width, h: c.height, px: [...d] }; }); };
for (const tpl of ['Cover-Wand', 'Highlight', 'Zahlen', 'Mix', 'Cover wall', 'Numbers']) {
  const b = await page.evaluateHandle(name => [...document.querySelectorAll('.chips button')].find(x => x.textContent.trim() === name), tpl);
  if (!(await b.evaluate(x => !!x))) continue;
  await b.evaluate(x => x.click()); // per Skript: die Tabbar liegt sonst über dem Knopf
  const d = await drawn();
  check(`share ${tpl} drawn`, d.w === 1080 && d.h === 1920, JSON.stringify(d) + ' ' + errs.join(' | '));
  if (!d.w) break;
  if (process.env.SHOTDIR) await (await page.$('canvas')).screenshot({ path: `${process.env.SHOTDIR}/share-${tpl.replace(/\W/g, '')}.png` });
}
for (const [f, h] of [['Post', 1350], ['Quadrat', 1080], ['Square', 1080]]) {
  const b = await page.evaluateHandle(name => [...document.querySelectorAll('.segmented button')].find(x => x.textContent.trim().startsWith(name)), f);
  if (!(await b.evaluate(x => !!x))) continue;
  await b.evaluate(x => x.click()); // per Skript: die Tabbar liegt sonst über dem Knopf
  check(`share format ${f}`, (await drawn()).h === h);
}
check('share no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
console.log(`UI-Test: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
