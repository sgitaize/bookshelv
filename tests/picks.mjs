// Issues 2026-10: „Was lese ich als Nächstes?“, Jahresziel, Mehrfach gelesen, Inhaltshinweise, Melden/Blockieren
const base = 'http://localhost:3999/api';
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? ok++ : (fail++, console.log('✗', n, x)); };
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const json = method !== 'GET';
    const res = await fetch(base + url, { method, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), cookie }, body: json ? JSON.stringify(body ?? {}) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
}
const simon = client();
await simon('POST', '/login', { username: 'simon', password: 'geheim1234' });
/** frisches Konto über eine Einladung von Simon (damit vorherige Tests nichts verfälschen) */
async function fresh(name) {
  const cl = client();
  const inv = await simon('POST', '/invites', { note: name });
  await cl('POST', '/register', { token: inv.data.token, username: name, displayName: name, password: 'geheim1234' });
  return cl;
}

// ---------- Was lese ich als Nächstes? ----------
const mia = await fresh('mia');
check('next empty pile', (await mia('GET', '/home/next')).data.book === null);
const mk = async (cl, title, pages, status = 'unread') => {
  const b = (await cl('POST', '/books', { title, authors: ['Testerin'], pages })).data;
  await cl('POST', '/copies', { bookId: b.id, format: 'print', readStatus: status });
  return b.id;
};
const short = await mk(mia, 'Kurz', 120), long = await mk(mia, 'Lang', 800), read = await mk(mia, 'Schon gelesen', 200, 'read');
const seen = new Set();
for (let i = 0; i < 20; i++) seen.add((await mia('GET', '/home/next')).data.book.id);
check('next only unread', seen.has(short) && seen.has(long) && !seen.has(read), JSON.stringify([...seen]));
let n = (await mia('GET', '/home/next?length=short')).data;
check('next length filter', n.book.id === short && n.matching === 1 && n.total === 2, JSON.stringify(n));
n = (await mia('GET', `/home/next?skip=${short}`)).data;
check('next skip', n.book.id === long && !n.restarted);
n = (await mia('GET', `/home/next?skip=${short},${long}`)).data;
check('next restarts after all shown', n.restarted && n.book.id === short, JSON.stringify(n));
check('next mood without reviews', (await mia('GET', '/home/next?mood=dark')).data.book === null);
// Stimmung aus fremder Bewertung (Simon liest „Lang“ und findet es düster)
await simon('PUT', `/books/${long}/review`, { rating: 4, text: '', visibility: 'instance', moods: ['dark'], pace: 'slow' });
n = (await mia('GET', '/home/next?mood=dark&pace=slow')).data;
check('next mood from others', n.book?.id === long && n.matching === 1, JSON.stringify(n));
await simon('PUT', `/books/${short}/review`, { rating: 2, text: '', visibility: 'private', moods: ['funny'] });
check('next ignores private reviews', (await mia('GET', '/home/next?mood=funny')).data.book === null);
check('next bad filter', (await mia('GET', '/home/next?mood=gruselig')).status === 400 && (await mia('GET', '/home/next?length=xl')).status === 400);

// ---------- Mehrfach gelesen ----------
const year = new Date().getFullYear();
const rb = await mk(mia, 'Lieblingsbuch', 300);
await mia('PUT', `/books/${rb}/reading`, { status: 'read', startedAt: '2023-01-02', finishedAt: '2023-02-01' });
await mia('PUT', `/books/${rb}/review`, { rating: 4, text: '', visibility: 'private' });
let rr = await mia('POST', `/books/${rb}/rereads`, { startedAt: `${year}-01-01`, finishedAt: `${year}-01-10`, rating: 5 });
check('reread add', rr.status === 200 && rr.data.length === 1 && rr.data[0].rating === 5, JSON.stringify(rr.data));
check('reread future 400', (await mia('POST', `/books/${rb}/rereads`, { finishedAt: '2999-01-01' })).status === 400);
check('reread end before start 400', (await mia('POST', `/books/${rb}/rereads`, { startedAt: `${year}-01-05`, finishedAt: `${year}-01-01` })).status === 400);
check('reread bad rating 400', (await mia('POST', `/books/${rb}/rereads`, { rating: 4.3 })).status === 400);
rr = await mia('POST', `/books/${rb}/rereads`, {});
check('reread ongoing', rr.data.length === 2 && rr.data[1].finishedAt === null && rr.data[1].startedAt, JSON.stringify(rr.data));
const ongoing = rr.data[1].id;
check('book detail rereads', (await mia('GET', `/books/${rb}`)).data.rereads.length === 2);
let st = (await mia('GET', `/stats?year=${year}`)).data;
// „Schon gelesen“ von oben zählt heute mit
check('reread counted this year', st.totals.books === 2 && st.totals.rereads === 1 && st.totals.avgRating === 5, JSON.stringify(st.totals));
st = (await mia('GET', '/stats')).data;
check('all years: two readings, one book', st.totals.books === 3 && st.perYear.length === 2 && st.authors[0].n === 3 && st.authors[0].ids.length === 2, JSON.stringify(st.perYear));
check('years list has reread year', st.years.includes(String(year)) && st.years.includes('2023'));
check('home counts reread', (await mia('GET', '/home')).data.counts.readThisYear === 2);
await mia("PATCH", `/rereads/${ongoing}`, { startedAt: `${year}-01-11`, finishedAt: `${year}-01-12` });
check('reread finished counts', (await mia('GET', `/stats?year=${year}`)).data.totals.books === 3);
check('foreign reread 404', (await simon('PATCH', `/rereads/${ongoing}`, { rating: 1 })).status === 404);
rr = await mia('DELETE', `/rereads/${ongoing}`);
check('reread delete', rr.data.length === 1);
const unreadBook = await mk(mia, 'Gleich nochmal', 100);
await mia('POST', `/books/${unreadBook}/rereads`, {});
check('reread marks first reading read', (await mia('GET', `/books/${unreadBook}`)).data.reading.status === 'read');
const exp = (await mia('GET', '/me/export.json')).data;
check('app export rereads', exp.items.find(i => i.title === 'Lieblingsbuch')?.app.rereads?.length === 1, JSON.stringify(exp.items.find(i => i.title === 'Lieblingsbuch')?.app));
check('gdpr export rereads', (await mia('GET', '/me/export')).data.rereads.length === 2);

// Zusammenführen (App → Konto): weitere Lektüren kommen mit, doppelte nicht, Rückgängig entfernt sie wieder
const item = { ...exp.items.find(i => i.title === 'Lieblingsbuch'), owned: true };
const leo = await fresh('leo');
let job = (await leo('POST', '/imports/jobs', { source: 'bookshelv-app', items: [item, item], options: { copies: 'owned', conflict: 'mine' } })).data;
for (let i = 0; i < 50 && (await leo('GET', `/imports/${job.id}`)).data.status === 'running'; i++) await new Promise(r => setTimeout(r, 200));
const leoBook = (await leo('GET', '/copies')).data.find(c => c.book.title === 'Lieblingsbuch')?.book.id;
check('merge rereads once', (await leo('GET', `/books/${leoBook}/rereads`)).data.length === 1, JSON.stringify((await leo('GET', `/imports/${job.id}`)).data));
await leo('POST', `/imports/${job.id}/undo`);
check('undo removes rereads', (await leo('GET', `/books/${leoBook}/rereads`)).data.length === 0);

console.log(`Vorschlag/Ziel/Mehrfach/Hinweise/Melden-Test: ${ok} ok, ${fail} fehlgeschlagen`);
