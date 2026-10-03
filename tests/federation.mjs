// Föderation zwischen zwei frischen Instanzen A (3997) und B (3996)
import fs from 'node:fs';
const A = 'http://localhost:3997', B = 'http://localhost:3996';
const [dirA, dirB] = process.argv.slice(2);
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? ok++ : (fail++, console.log('✗', n, x)); };
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const json = method !== 'GET';
    const res = await fetch(base + '/api' + url, { method, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), cookie }, body: json ? JSON.stringify(body ?? {}) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
}
async function setup(base, dir, username) {
  const c = client(base);
  await c('POST', '/setup', { token: fs.readFileSync(`${dir}/data/setup-token.txt`, 'utf8').trim(), username, password: 'geheim1234' });
  return c;
}
// Bis eine Bedingung erfüllt ist (Zustellung läuft asynchron)
async function until(fn, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(250); } return false; }

const adminA = await setup(A, dirA, 'simon');
const adminB = await setup(B, dirB, 'anna');
await adminA('PATCH', '/admin/federation', { name: 'Instanz A' });
await adminB('PATCH', '/admin/federation', { name: 'Instanz B' });

// Kopplung
check('A not linked to itself', (await adminA('POST', '/admin/federation/link', { url: A })).status === 400);
let r = await adminA('POST', '/admin/federation/link', { url: B });
check('link request sent', r.status === 200 && r.data.status === 'pending_out', JSON.stringify(r.data));
let fb = (await adminB('GET', '/admin/federation')).data;
check('B sees pending_in', fb.instances.length === 1 && fb.instances[0].status === 'pending_in' && fb.instances[0].name === 'Instanz A');
check('unlinked inbox rejected', (await fetch(B + '/api/fed/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bs-origin': 'http://localhost:1' }, body: '{"type":"Review"}' })).status >= 400);
await adminB('POST', `/admin/federation/${fb.instances[0].id}/accept`);
check('A becomes linked', await until(async () => (await adminA('GET', '/admin/federation')).data.instances[0]?.status === 'linked'));

// Gefälschte Nachricht (falsche Signatur) wird abgelehnt
check('forged signature rejected', (await fetch(B + '/api/fed/inbox', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-bs-origin': A, 'x-bs-date': new Date().toISOString(), 'x-bs-signature': 'AAAA' },
  body: '{"type":"ReviewDelete","id":1}' })).status === 401);

// Föderierte Review
const isbn = '9783453317178';
const bookA = (await adminA('POST', '/catalog/isbn', { isbn })).data.book;
const bookB = (await adminB('POST', '/catalog/isbn', { isbn })).data.book;
await adminA('PUT', `/books/${bookA.id}/review`, { rating: 4.5, text: 'Großartig', visibility: 'federated' });
check('review arrives at B', await until(async () => (await adminB('GET', `/books/${bookB.id}/reviews`)).data.remote?.length === 1));
let rv = (await adminB('GET', `/books/${bookB.id}/reviews`)).data;
check('remote review content', rv.remote[0].rating === 4.5 && rv.remote[0].user.handle === '@simon@localhost:3997' && rv.average === 4.5, JSON.stringify(rv.remote[0]));
await adminA('PUT', `/books/${bookA.id}/review`, { rating: 4.5, text: 'Großartig', visibility: 'instance' });
check('retracted when no longer federated', await until(async () => (await adminB('GET', `/books/${bookB.id}/reviews`)).data.remote.length === 0));

// Verleih von A an @anna@B
const copy = (await adminA('POST', '/copies', { bookId: bookA.id, format: 'print' })).data;
check('unknown remote user 404', (await adminA('POST', `/copies/${copy.id}/loans`, { borrowerHandle: '@niemand@localhost:3996' })).status === 404);
check('unlinked instance 400', (await adminA('POST', `/copies/${copy.id}/loans`, { borrowerHandle: '@anna@example.org' })).status === 400);
r = await adminA('POST', `/copies/${copy.id}/loans`, { borrowerHandle: '@anna@localhost:3996', dueAt: '2099-01-01' });
check('remote loan created', r.status === 200, JSON.stringify(r.data));
check('A shows borrower handle', (await adminA('GET', '/loans')).data.lent[0]?.borrower?.displayName.includes('@anna@localhost:3996'));
check('B anna sees borrowed', await until(async () => (await adminB('GET', '/loans')).data.borrowed.length === 1));
const borrowed = (await adminB('GET', '/loans')).data.borrowed[0];
check('borrowed details', borrowed.lender.displayName.includes('@simon@localhost:3997') && borrowed.dueAt === '2099-01-01' && borrowed.book.title.includes('Wüstenplanet'), JSON.stringify(borrowed));
const nB = (await adminB('GET', '/notifications')).data;
check('B notified', nB.items.some(i => i.type === 'loan_new' && i.actor?.displayName.includes('@simon@')));
await adminA('PATCH', `/loans/${r.data.id}`, { dueAt: '2099-02-01' });
check('due change synced', await until(async () => (await adminB('GET', '/loans')).data.borrowed[0]?.dueAt === '2099-02-01'));
await adminB('POST', `/remote-loans/${borrowed.remoteLoanId}/return`);
check('return synced to A', await until(async () => (await adminA('GET', '/loans')).data.lent.length === 0));
check('A notified of return', (await adminA('GET', '/notifications')).data.items.some(i => i.type === 'loan_returned'));
check('A history has got_back', (await adminA('GET', '/history?types=got_back')).data.events.length === 1);

// Entkoppeln
const instB = (await adminB('GET', '/admin/federation')).data.instances[0];
await adminB('DELETE', `/admin/federation/${instB.id}`);
check('A unlinked too', await until(async () => (await adminA('GET', '/admin/federation')).data.instances.length === 0));
check('A keeps loan name as text', (await adminA('GET', '/history?types=lent')).data.events[0]?.person?.includes('anna'));
console.log(`Föderations-Test: ${ok} ok, ${fail} fehlgeschlagen`);
