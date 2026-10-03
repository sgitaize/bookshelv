const base = 'http://localhost:3999/api';
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? ok++ : (fail++, console.log('✗', n, x)); };
function client() {
  let cookie = '';
  return async (method, url, body) => {
    // wie der echte Client: schreibende Anfragen immer als JSON
    const json = method !== 'GET';
    const res = await fetch(base + url, { method, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), cookie }, body: json ? JSON.stringify(body ?? {}) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
}
const simon = client(), anna = client(), ben = client();
for (const [c, u] of [[simon, 'simon'], [anna, 'anna'], [ben, 'ben']]) await c('POST', '/login', { username: u, password: 'geheim1234' });
const copies = (await simon('GET', '/copies')).data;
const users = (await simon('GET', '/users')).data;
const annaId = users.find(u => u.username === 'anna').id, benId = users.find(u => u.username === 'ben').id;
const [c1, c2] = copies;
const today = new Date().toISOString().slice(0, 10);
check('lend to anna', (await simon('POST', `/copies/${c1.id}/loans`, { borrowerId: annaId, dueAt: '2026-10-01', note: 'Bitte nicht knicken' })).status === 400, 'due before lent should fail');
let r = await simon('POST', `/copies/${c1.id}/loans`, { borrowerId: annaId, lentAt: '2026-09-01', dueAt: '2026-09-20', note: 'Bitte nicht knicken' });
check('lend ok', r.status === 200, JSON.stringify(r.data));
const loanA = r.data.id;
check('double lend 409', (await simon('POST', `/copies/${c1.id}/loans`, { borrowerName: 'Oma' })).status === 409);
check('lend to self 400', (await simon('POST', `/copies/${c2.id}/loans`, { borrowerId: (await simon('GET', '/me')).data.id })).status === 400);
check('no borrower 400', (await simon('POST', `/copies/${c2.id}/loans`, {})).status === 400);
check('not own copy 404', (await ben('POST', `/copies/${c2.id}/loans`, { borrowerName: 'x' })).status === 404);
check('lend to free name', (await simon('POST', `/copies/${c2.id}/loans`, { borrowerName: 'Oma Hilde' })).status === 200);
// Sichtweisen
let L = (await simon('GET', '/loans')).data;
check('simon lent 2', L.lent.length === 2);
check('overdue flagged', L.lent.find(l => l.id === loanA).overdue === true);
check('free name visible to lender', L.lent.some(l => l.borrower?.displayName === 'Oma Hilde'));
L = (await anna('GET', '/loans')).data;
check('anna borrowed 1', L.borrowed.length === 1 && L.borrowed[0].lender.displayName === 'Simon');
check('anna sees note', L.borrowed[0].note === 'Bitte nicht knicken');
const bookOfC2 = c2.book.id;
const detailBen = (await ben('GET', `/books/${bookOfC2}`)).data;
const cp = detailBen.copies.find(x => x.id === c2.id);
check('ben sees lent but no free name', cp.loan && cp.loan.borrowerName === null, JSON.stringify(cp.loan));
const detailBen1 = (await ben('GET', `/books/${c1.book.id}`)).data.copies.find(x => x.id === c1.id);
check('ben sees registered borrower', detailBen1.loan.borrowerName === 'Anna');
check('ben no due/note', detailBen1.loan.dueAt === null && detailBen1.loan.note === null);
check('shelf lent flag', (await simon('GET', '/copies')).data.find(x => x.id === c1.id).lent === true);
// Rechte
check('ben cannot return', (await ben('POST', `/loans/${loanA}/return`, {})).status === 404);
check('anna cannot edit due', (await anna('PATCH', `/loans/${loanA}`, { dueAt: '2026-12-01' })).status === 404);
check('simon edits due', (await simon('PATCH', `/loans/${loanA}`, { dueAt: '2026-12-01' })).status === 200);
check('no longer overdue', (await simon('GET', '/loans')).data.lent.find(l => l.id === loanA).overdue === false);
check('anna returns', (await anna('POST', `/loans/${loanA}/return`, {})).status === 200);
L = (await simon('GET', '/loans')).data;
check('history has it', L.history.some(l => l.id === loanA && l.returnedAt === today) && L.lent.length === 1);
check('can lend again', (await simon('POST', `/copies/${c1.id}/loans`, { borrowerId: benId })).status === 200);
check('en error', (await (async () => { const res = await fetch(base + `/copies/${c1.id}/loans`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': 'en', cookie: '' }, body: '{}' }); return (await res.json()).error; })()) === 'Not signed in');
console.log(`Verleih-Test: ${ok} ok, ${fail} fehlgeschlagen`);

// ---- Archiv / Löschen ----
{
  let ok2 = 0, fail2 = 0;
  const chk = (n, c, x = '') => { c ? ok2++ : (fail2++, console.log('✗', n, x)); };
  const mine = (await simon('GET', '/copies')).data;
  const lentCopy = mine.find(x => x.lent);
  chk('archive lent copy 409', (await simon('DELETE', `/copies/${lentCopy.id}`, { mode: 'archive', reason: 'sold' })).status === 409);
  const free = mine.find(x => !x.lent);
  chk('archive sold', (await simon('DELETE', `/copies/${free.id}`, { mode: 'archive', reason: 'sold' })).status === 200);
  chk('gone from shelf', !(await simon('GET', '/copies')).data.some(x => x.id === free.id));
  const arch = (await simon('GET', '/copies?archived=1')).data;
  chk('in archive with reason', arch.some(x => x.id === free.id && x.removedReason === 'sold'));
  const h = (await simon('GET', `/history?book=${free.book.id}`)).data.events;
  chk('history has removed+sold', h.some(e => e.type === 'removed' && e.reason === 'sold') && h.some(e => e.type === 'added'));
  chk('restore', (await simon('POST', `/copies/${free.id}/restore`)).status === 200 && (await simon('GET', '/copies')).data.some(x => x.id === free.id));
  await simon('DELETE', `/copies/${free.id}`, { mode: 'archive', reason: 'given_away' });
  chk('purge archived', (await simon('DELETE', `/copies/${free.id}`, { mode: 'purge' })).status === 200);
  chk('purged gone from archive', !(await simon('GET', '/copies?archived=1')).data.some(x => x.id === free.id));
  const hist = (await simon('GET', '/history?types=lent,got_back')).data;
  chk('history filter types', hist.events.every(e => e.type === 'lent' || e.type === 'got_back') && hist.events.length >= 2, JSON.stringify(hist.events.map(e => e.type)));
  chk('history date filter', (await simon('GET', '/history?from=2026-09-01&to=2026-09-30')).data.events.every(e => e.date.startsWith('2026-09')));
  chk('history search', (await simon('GET', '/history?q=hilde')).data.events.every(e => (e.person ?? '').includes('Hilde')));
  chk('history bad date 400', (await simon('GET', '/history?from=gestern')).status === 400);
  console.log(`Archiv/Verlauf-Test: ${ok2} ok, ${fail2} fehlgeschlagen`);
}

// ---- Regression: DELETE/POST ohne Inhalt (Einladung zurückziehen, Kommentar löschen) ----
{
  const inv = await simon('POST', '/invites', { note: 'x' });
  const list = (await simon('GET', '/invites')).data;
  const res = await simon('DELETE', `/invites/${list.find(i => i.token === inv.data.token).id}`);
  console.log(res.status === 200 ? 'Regression DELETE ohne Inhalt: ok' : `✗ Regression DELETE ohne Inhalt: ${res.status}`);
}

// ---- E-Book-Shops und Zählung pro Buch ----
{
  let ok3 = 0, fail3 = 0;
  const chk = (n, c, x = '') => { c ? ok3++ : (fail3++, console.log('✗', n, x)); };
  const stores = (await simon('GET', '/stores')).data;
  chk('default stores', stores.some(s => s.name === 'tolino') && stores.length >= 10);
  const s1 = (await simon('POST', '/stores', { name: 'Osiander' })).data;
  const s2 = (await anna('POST', '/stores', { name: 'osiander' })).data;
  chk('store dedupe case-insensitive', s1.id === s2.id);
  const home1 = (await simon('GET', '/home')).data;
  const printCopy = (await simon('GET', '/copies')).data.find(x => x.format === 'print' && x.readStatus === 'unread');
  const r = await simon('POST', '/copies', { bookId: printCopy.book.id, format: 'ebook', storeId: s1.id, binding: 'hardcover', sprayedEdges: true });
  const eb = (await simon('GET', '/copies')).data.find(x => x.id === r.data.id);
  chk('ebook has store, no binding/edges', eb.store === 'Osiander' && eb.binding === null && eb.sprayedEdges === false, JSON.stringify(eb));
  const home2 = (await simon('GET', '/home')).data;
  chk('to-read counts books not copies', home2.toReadCount === home1.toReadCount && home2.counts.books === home1.counts.books,
    `${home1.toReadCount}/${home2.toReadCount} ${home1.counts.books}/${home2.counts.books}`);
  chk('print copy ignores store', (await simon('PATCH', `/copies/${printCopy.id}`, { storeId: s1.id })).status === 200
    && (await simon('GET', '/copies')).data.find(x => x.id === printCopy.id).storeId === null);
  console.log(`Shop/Zählung-Test: ${ok3} ok, ${fail3} fehlgeschlagen`);
}
