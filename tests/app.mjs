// App: Lokal-Modus, offene Registrierung, Instanz-Proxy mit Anmeldung, Zusammenführen (lokal → Konto) + Rückgängig,
// Sicherung/Wiederherstellung/Archiv. Startet eine eigene Instanz (dist/server.js) und den App-Host (native/build/server/host.js).
// Voraussetzung: npm run build && (cd server && node build-mobile.mjs) und BOOKSHELV_SQLITE_ADDON (siehe native/README.md).
// Aufruf: BOOKSHELV_SQLITE_ADDON=… [HOST_NODE="…/node18 --jitless"] node tests/app.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.BOOKSHELV_SQLITE_ADDON) { console.log('App-Test übersprungen (BOOKSHELV_SQLITE_ADDON fehlt)'); process.exit(0); }
const root = path.resolve(import.meta.dirname, '..');
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? ok++ : (fail++, console.log('✗', n, x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-app-'));
const inst = path.join(tmp, 'inst'), app = path.join(tmp, 'app');
fs.mkdirSync(inst); fs.mkdirSync(path.join(app, 'data'), { recursive: true }); fs.mkdirSync(path.join(app, 'var'));
fs.copyFileSync(path.join(root, 'dist/server.js'), path.join(inst, 'server.js'));
fs.cpSync(path.join(root, 'dist/public'), path.join(inst, 'public'), { recursive: true });

const IP = 3995, C = 4111, L = 4112, R = 4113, TOKEN = 'apptoken-test-123';
const procs = [];
procs.push(spawn('node', ['server.js'], { cwd: inst, env: { ...process.env, PORT: IP, BOOKSHELV_INSECURE_COOKIES: '1', BOOKSHELV_NO_BACKFILL: '1', NODE_NO_WARNINGS: '1' }, stdio: 'ignore' }));
const [hostNode, ...hostArgs] = (process.env.HOST_NODE ?? 'node').split(' ');
procs.push(spawn(hostNode, [...hostArgs, path.join(root, 'native/build/server/host.js')], {
  cwd: app, stdio: ['ignore', fs.openSync(path.join(app, 'host.log'), 'w'), fs.openSync(path.join(app, 'host.log'), 'a')],
  env: { ...process.env, BS_TOKEN: TOKEN, BS_CONTROL_PORT: C, BS_LOCAL_PORT: L, BS_REMOTE_PORT: R, BS_DATA: path.join(app, 'data'),
    BS_VAR: path.join(app, 'var'), BS_PUBLIC: path.join(root, 'native/build/server/public'), BOOKSHELV_NO_BACKFILL: '1', NODE_NO_WARNINGS: '1' }
}));
const cleanup = () => { for (const p of procs) p.kill(); fs.rmSync(tmp, { recursive: true, force: true }); };
process.on('exit', cleanup);

async function up(url) { for (let i = 0; i < 100; i++) { try { await fetch(url); return; } catch { await sleep(100); } } throw new Error('startet nicht: ' + url); }
await up(`http://localhost:${IP}/api/status`);
await up(`http://127.0.0.1:${R}/`);

/** HTTP-Client mit Cookie-Gedächtnis; origin wie die WebView */
function client(base, origin, cookie0 = '') {
  let cookie = cookie0;
  return async (method, url, body, extra = {}) => {
    const json = method !== 'GET';
    const res = await fetch(base + url, { method, headers: { ...(json ? { 'content-type': 'application/json', origin } : {}), cookie, ...extra }, body: json ? JSON.stringify(body ?? {}) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  };
}
const control = async (method, p, body) => {
  const res = await fetch(`http://127.0.0.1:${C}${p}`, { method, headers: { 'x-bs-token': TOKEN, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  return { status: res.status, data: await res.json() };
};

// ---------- Instanz: Admin, offene Registrierung ----------
const admin = client(`http://localhost:${IP}/api`, `http://localhost:${IP}`);
const setupToken = fs.readFileSync(path.join(inst, 'data/setup-token.txt'), 'utf8').trim();
check('instance setup', (await admin('POST', '/setup', { token: setupToken, username: 'admin', password: 'geheim1234' })).status === 200);
const guest = client(`http://localhost:${IP}/api`, `http://localhost:${IP}`);
check('register closed by default', (await guest('POST', '/register', { username: 'zoe', password: 'geheim1234' })).status === 403);
check('status says closed', (await guest('GET', '/status')).data.openRegistration === false);
check('open registration', (await admin('PATCH', '/admin/instance', { openRegistration: true })).data.openRegistration === true);
check('status says open', (await guest('GET', '/status')).data.openRegistration === true);
check('register without invite', (await guest('POST', '/register', { username: 'zoe', password: 'geheim1234', displayName: 'Zoe' })).status === 200);
check('imprint kept', (await admin('GET', '/admin/instance')).data.imprintUrl === '');
// Höchstzahl Konten + Bremse für die offene Registrierung
check('default limit', (await admin('GET', '/admin/instance')).data.maxUsers === 200);
check('set limit', (await admin('PATCH', '/admin/instance', { maxUsers: 2 })).data.maxUsers === 2);
let st0 = (await guest('GET', '/status')).data;
check('status full', st0.full === true && st0.openRegistration === false && st0.capacity === 'full', JSON.stringify(st0));
check('register blocked when full', (await client(`http://localhost:${IP}/api`, `http://localhost:${IP}`)('POST', '/register', { username: 'voll', password: 'geheim1234' })).status === 403);
check('unlimited', (await admin('PATCH', '/admin/instance', { maxUsers: 0 })).data.maxUsers === 0 && !(await guest('GET', '/status')).data.full && (await guest('GET', '/status')).data.capacity === 'ok');
const ipReg = n => client(`http://localhost:${IP}/api`, `http://localhost:${IP}`)('POST', '/register', { username: `spam${n}`, password: 'geheim1234' }, { 'x-forwarded-for': '203.0.113.9' });
check('3 per ip ok', (await ipReg(1)).status === 200 && (await ipReg(2)).status === 200 && (await ipReg(3)).status === 200);
check('4th per ip throttled', (await ipReg(4)).status === 429);
// 5 Konten (admin, zoe, spam1–3) + 4 per Einladung (zählen nicht zur Bremse) = 9 von 10 → fast voll
for (let i = 0; i < 4; i++) {
  const tok = (await admin('POST', '/invites', {})).data.token;
  await client(`http://localhost:${IP}/api`, `http://localhost:${IP}`)('POST', '/register', { token: tok, username: `inv${i}`, password: 'geheim1234' }, { 'x-forwarded-for': '203.0.113.9' });
}
await admin('PATCH', '/admin/instance', { maxUsers: 10 });
check('nearly full', (await guest('GET', '/status')).data.capacity === 'nearly' && (await guest('GET', '/status')).data.openRegistration === true);
await admin('PATCH', '/admin/instance', { maxUsers: 200 });

// ---------- Steuerung ----------
check('control needs token', (await fetch(`http://127.0.0.1:${C}/state`)).status === 403);
let st = (await control('GET', '/state')).data;
check('no local library by default', st.local.exists === false && st.local.running === false && st.remote.url === null);

// ---------- Lokal-Modus ----------
check('local start', (await control('POST', '/local/start', { name: 'Simon' })).data.summary.name === 'Simon');
const me = client(`http://127.0.0.1:${L}/api`, `http://127.0.0.1:${L}`, `bs_app=${TOKEN}`);
const anon = client(`http://127.0.0.1:${L}/api`, `http://127.0.0.1:${L}`);
check('local me', (await me('GET', '/me')).data?.local === true);
check('local without token', (await anon('GET', '/me')).status === 401);
check('local status', (await anon('GET', '/status')).data.local === true && (await anon('GET', '/status')).data.needsSetup === false);
for (const [m, u] of [['POST', '/invites'], ['POST', '/login'], ['GET', '/users'], ['GET', '/friends/requests'], ['GET', '/admin/users'], ['GET', '/reads'], ['DELETE', '/me']])
  check(`local blocks ${m} ${u}`, (await me(m, u, {})).status === 403);

// lokale Bibliothek füllen (ohne Katalog: manuelle Bücher)
const mk = async (title, authors, extra = {}) => (await me('POST', '/books', { title, authors, ...extra })).data;
const b1 = await mk('Der kleine Hobbit', ['J. R. R. Tolkien'], { pages: 300 });
const b2 = await mk('Momo', ['Michael Ende']);
const b3 = await mk('Wunschbuch', ['Jemand']);
const c1 = (await me('POST', '/copies', { bookId: b1.id, format: 'print', binding: 'hardcover', sprayedEdges: true, notes: 'signiert' })).data;
await me('POST', '/copies', { bookId: b2.id, format: 'ebook' });
await me('PUT', `/books/${b1.id}/reading`, { status: 'read', startedAt: '2025-01-02', finishedAt: '2025-01-20' });
await me('PUT', `/books/${b2.id}/reading`, { status: 'reading', progress: 40 });
await me('PUT', `/books/${b1.id}/review`, { rating: 4.5, text: 'Schön', moods: ['adventurous', 'funny'], pace: 'fast', visibility: 'private' });
await me('PUT', `/books/${b3.id}/wishlist`, { note: 'zum Geburtstag' });
const list = (await me('POST', '/lists', { name: 'Klassiker', description: 'Alte Lieblinge' })).data;
await me('PUT', `/lists/${list.id}/books/${b1.id}`, {});
await me('PUT', '/me/top', { bookIds: [b1.id] });
await me('POST', `/copies/${c1.id}/loans`, { borrowerName: 'Oma', dueAt: '2030-01-01' });
await me('POST', '/authors/follow', { name: 'Michael Ende' });
const png = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'web/public/icon-192.png')).toString('base64');
check('own cover local', (await me('POST', `/books/${b2.id}/cover`, { image: png })).status === 200);
const sum = (await control('GET', '/state')).data.local.summary;
check('local summary', sum.books === 2 && sum.read === 1 && sum.reviews === 1 && sum.wishlist === 1 && sum.lists === 1 && sum.loans === 1, JSON.stringify(sum));

const exp = (await me('GET', '/me/export.json')).data;
check('export format', exp.format === 'bookshelv-app' && exp.items.length === 3 && exp.follows.includes('Michael Ende'));
const hob = exp.items.find(i => i.title === 'Der kleine Hobbit');
check('export details', hob.app.copies[0].loans[0].borrower === 'Oma' && hob.app.moods.length === 2 && hob.app.topRank === 1 && hob.lists[0].description === 'Alte Lieblinge', JSON.stringify(hob));
check('export own cover', exp.items.find(i => i.title === 'Momo').app.cover?.startsWith('data:image/png'));

// ---------- Sicherung / Wiederherstellung ----------
const snapDir = path.join(tmp, 'icloud');
const snap = (await control('POST', '/local/snapshot', { dir: snapDir })).data;
check('snapshot', fs.existsSync(path.join(snapDir, 'bookshelv.db')) && snap.size > 0 && snap.summary.books === 2, JSON.stringify(snap));
fs.cpSync(path.join(app, 'data/covers'), path.join(snapDir, 'covers'), { recursive: true });
await me('DELETE', `/books/${b3.id}/wishlist`);
check('changed after snapshot', (await control('GET', '/state')).data.local.summary.wishlist === 0);
check('backup check', (await control('POST', '/local/check', { dir: snapDir })).status === 200);
fs.mkdirSync(path.join(tmp, 'junk')); fs.writeFileSync(path.join(tmp, 'junk/bookshelv.db'), 'kein sqlite');
check('broken backup rejected', (await control('POST', '/local/check', { dir: path.join(tmp, 'junk') })).status === 400);
const restored = (await control('POST', '/local/restore', { dir: snapDir })).data;
check('restore', restored.summary?.wishlist === 1 && restored.summary.books === 2, JSON.stringify(restored));
check('works after restore', (await me('GET', '/wishlist')).data.length === 1 && (await me('GET', '/me')).data.displayName === 'Simon');

// ---------- Instanz über den Proxy ----------
check('probe bad url', (await control('POST', '/remote/probe', { url: 'http://127.0.0.1:1' })).status === 400);
const probe = (await control('POST', '/remote/probe', { url: `http://localhost:${IP}` })).data;
check('probe instance', probe.url === `http://localhost:${IP}` && probe.status.openRegistration === true, JSON.stringify(probe));
await control('POST', '/remote/use', { url: `http://localhost:${IP}` });
const web = client(`http://127.0.0.1:${R}/api`, `http://127.0.0.1:${R}`);
check('proxy not logged in', (await web('GET', '/me')).status === 401);
const login = await web('POST', '/login', { username: 'zoe', password: 'geheim1234' });
check('login via proxy', login.status === 200 && !login.headers.get('set-cookie'), String(login.status));
check('session kept in host', (await web('GET', '/me')).data?.username === 'zoe');
check('control sees login', (await control('GET', '/state')).data.remote.loggedIn === true && (await control('GET', '/remote/me')).data.me.username === 'zoe');
check('spa served', (await fetch(`http://127.0.0.1:${R}/shelf`)).headers.get('content-type').includes('text/html'));

// Konto hat Momo schon „gelesen“ → Konflikt beim Lesestand; Hobbit als E-Book → neues Druck-Exemplar dazu
const zoe = client(`http://localhost:${IP}/api`, `http://localhost:${IP}`);
await zoe('POST', '/login', { username: 'zoe', password: 'geheim1234' });
const rm = (await zoe('POST', '/books', { title: 'Momo', authors: ['Michael Ende'] })).data;
await zoe('PUT', `/books/${rm.id}/reading`, { status: 'read', finishedAt: '2020-05-05' });
const rh = (await zoe('POST', '/books', { title: 'Der kleine Hobbit', authors: ['J. R. R. Tolkien'] })).data;
await zoe('POST', '/copies', { bookId: rh.id, format: 'ebook' });

// ---------- Zusammenführen ----------
const job = (await control('POST', '/merge/start', { conflict: 'ask', visibility: 'private', label: 'iPhone' })).data;
check('merge started', job.id > 0 && job.total === 3, JSON.stringify(job));
let js;
for (let i = 0; i < 100; i++) { js = (await control('POST', '/merge/status', { id: job.id })).data; if (js.status !== 'running') break; await sleep(200); }
check('merge done', js.status === 'done' && js.failed.length === 0, JSON.stringify(js));
check('merge conflict on status', js.conflictCount === 1 && js.conflicts[0].field === 'status', JSON.stringify(js.conflicts));
const shelf = (await zoe('GET', '/copies')).data;
check('copies merged', shelf.filter(c => c.book.id === rh.id).length === 2 && shelf.some(c => c.book.id === rm.id && c.format === 'ebook'), JSON.stringify(shelf.map(c => [c.book.title, c.format])));
const hobbit = (await zoe('GET', `/books/${rh.id}`)).data;
check('reading merged', hobbit.reading.status === 'read' && hobbit.reading.finishedAt === '2025-01-20', JSON.stringify(hobbit.reading));
const rv = (await zoe('GET', `/books/${rh.id}/reviews`)).data.reviews.find(r => r.mine);
check('review + moods merged', rv?.rating === 4.5 && rv.moods.length === 2 && rv.pace === 'fast' && rv.visibility === 'private', JSON.stringify(rv));
const loans = (await zoe('GET', '/loans')).data;
check('loan merged', loans.lent.some(l => l.borrower?.displayName === 'Oma'), JSON.stringify(loans.lent));
check('list merged', (await zoe('GET', '/lists')).data.some(l => l.name === 'Klassiker' && l.description === 'Alte Lieblinge'));
check('top merged', (await zoe('GET', '/me/top')).data.some(b => b.id === rh.id));
check('follow merged', (await zoe('GET', '/authors/following')).data.includes('Michael Ende'));
check('wishlist merged', (await zoe('GET', '/wishlist')).data.some(w => w.note === 'zum Geburtstag'));
check('momo kept mine', (await zoe('GET', `/books/${rm.id}`)).data.reading.status === 'read');
check('own cover merged', !!(await zoe('GET', `/books/${rm.id}`)).data.book?.coverUrl || !!(await zoe('GET', `/books/${rm.id}`)).data.coverUrl);
const again = (await control('POST', '/merge/start', { conflict: 'mine' })).data;
for (let i = 0; i < 100; i++) { js = (await control('POST', '/merge/status', { id: again.id })).data; if (js.status !== 'running') break; await sleep(200); }
check('second merge adds nothing', (await zoe('GET', '/copies')).data.length === shelf.length && (await zoe('GET', '/loans')).data.lent.length === loans.lent.length);
// beide Zusammenführungen zurück
await web('POST', `/imports/${again.id}/undo`, {});
const undo = await web('POST', `/imports/${job.id}/undo`, {});
check('undo via proxy', undo.status === 200 && undo.data.skipped === 0, JSON.stringify(undo.data));
const after = (await zoe('GET', '/copies')).data;
check('undo removed merged copies', after.length === 1 && after[0].format === 'ebook', JSON.stringify(after.map(c => [c.book.title, c.format])));
check('undo removed loans/follows', (await zoe('GET', '/loans')).data.lent.length === 0 && !(await zoe('GET', '/authors/following')).data.includes('Michael Ende'));

// ---------- Archiv + Abmelden ----------
const arch = (await control('POST', '/local/archive')).data;
check('archive', fs.existsSync(path.join(arch.archive, 'bookshelv.db')));
const empty = (await control('GET', '/state')).data.local.summary;
check('local library empty after archive', empty.books === 0 && empty.reviews === 0, JSON.stringify(empty));
await control('POST', '/remote/logout');
check('logout', (await web('GET', '/me')).status === 401 && (await control('GET', '/state')).data.remote.loggedIn === false);

console.log(`App-Test: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) { console.log(fs.readFileSync(path.join(app, 'host.log'), 'utf8').split('\n').filter(l => !l.includes('Warning')).slice(-15).join('\n')); process.exitCode = 1; }
cleanup();
process.exit();
