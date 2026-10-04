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
// Leihanfragen: Anna bittet Simon um ein Exemplar, Simon nimmt an bzw. lehnt ab, Anna zieht zurück
const mine = (await simon('GET', '/copies')).data;
const free = mine.filter(x => !x.lent && x.format === 'print');
const ebook = mine.find(x => x.format === 'ebook');
check('test data has a free print copy', free.length >= 1, free.length);
const p1 = free[0];
const p2id = (await simon('POST', '/copies', { bookId: p1.book.id, format: 'print', binding: 'hardcover', sprayedEdges: false, notes: '', storeId: null })).data.id;
const p2 = { id: p2id, book: p1.book };

let r = await anna('POST', `/copies/${p1.id}/requests`, { message: 'Darf ich?' });
check('request created', r.status === 200 && r.data.id, JSON.stringify(r));
const req1 = r.data.id;
check('request idempotent', (await anna('POST', `/copies/${p1.id}/requests`, {})).data.id === req1);
check('own copy rejected', (await simon('POST', `/copies/${p1.id}/requests`, {})).status === 400);
if (ebook) check('ebook rejected', (await anna('POST', `/copies/${ebook.id}/requests`, {})).status === 400);
check('book detail shows my request', (await anna('GET', `/books/${p1.book.id}`)).data.copies.find(x => x.id === p1.id).requestId === req1);
const notes = (await simon('GET', '/notifications')).data;
check('owner notified', JSON.stringify(notes).includes('loan_request'));
let L = (await simon('GET', '/loans')).data;
check('incoming listed', L.requests.incoming.some(x => x.id === req1 && x.message === 'Darf ich?' && x.requester.displayName));
check('outgoing listed', (await anna('GET', '/loan-requests')).data.outgoing.some(x => x.id === req1 && x.status === 'pending'));
check('only owner accepts', (await ben('POST', `/loan-requests/${req1}/accept`, {})).status === 404);
const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
r = await simon('POST', `/loan-requests/${req1}/accept`, { dueAt: due });
check('accept creates loan', r.status === 200 && r.data.loanId, JSON.stringify(r));
L = (await anna('GET', '/loans')).data;
check('borrower sees loan', L.borrowed.some(l => l.id === r.data.loanId && l.dueAt === due));
check('request accepted', L.requests.outgoing.find(x => x.id === req1).status === 'accepted');
check('accept twice → 409', (await simon('POST', `/loan-requests/${req1}/accept`, {})).status === 409);
// zweite Anfrage aufs verliehene Exemplar: Annehmen geht nicht, Ablehnen schon
const req2 = (await ben('POST', `/copies/${p1.id}/requests`, {})).data.id;
check('lent copy → accept 409', (await simon('POST', `/loan-requests/${req2}/accept`, {})).status === 409);
check('decline', (await simon('POST', `/loan-requests/${req2}/decline`, {})).status === 200);
check('declined notified', JSON.stringify((await ben('GET', '/notifications')).data).includes('loan_declined'));
// Zurückziehen räumt die Glocke der Besitzer*in auf
const req3 = (await ben('POST', `/copies/${p2.id}/requests`, {})).data.id;
check('only requester cancels', (await anna('DELETE', `/loan-requests/${req3}`)).status === 404);
check('cancel', (await ben('DELETE', `/loan-requests/${req3}`)).status === 200);
check('cancel removes notification', !(await simon('GET', '/notifications')).data.items?.some?.(n => n.type === 'loan_request' && n.refId === req3)
  && !JSON.stringify((await simon('GET', '/notifications')).data).includes(`"refId":${req3}`));
// direkt verliehen → offene Anfrage gilt als angenommen
const req4 = (await ben('POST', `/copies/${p2.id}/requests`, {})).data.id;
const loan4 = (await simon('POST', `/copies/${p2.id}/loans`, { borrowerId: (await simon('GET', '/users')).data.find(u => u.username === 'ben').id })).data.id;
check('direct loan accepts request', (await ben('GET', '/loan-requests')).data.outgoing.find(x => x.id === req4)?.status === 'accepted');
// aufräumen, damit spätere Tests freie Exemplare haben
await simon('DELETE', `/loans/${loan4}`); await simon('DELETE', `/loans/${r.data.loanId}`);
await simon('DELETE', `/copies/${p2id}`, { mode: 'purge' });
console.log(`Leihanfragen-Test: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
