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
// Hörbücher: Format audio mit Länge, Shop, Statistik (Minuten statt Seiten), Export
const book = (await simon('GET', '/copies')).data[0].book;
const stores = (await simon('GET', '/stores')).data;
const audible = stores.find(s => s.name === 'Audible');
check('audio stores seeded', !!audible && stores.some(s => s.name === 'BookBeat'));
let r = await anna('POST', '/copies', { bookId: book.id, format: 'audio', durationMin: 754, storeId: audible.id, binding: 'hardcover', sprayedEdges: true, notes: '' });
check('audio copy created', r.status === 200, JSON.stringify(r));
const cid = r.data.id;
let cp = (await anna('GET', `/books/${book.id}`)).data.copies.find(c => c.id === cid);
check('audio fields', cp.format === 'audio' && cp.durationMin === 754 && cp.binding === null && cp.sprayedEdges === false && cp.store === 'Audible', JSON.stringify(cp));
check('bad format rejected → print', (await anna('PATCH', `/copies/${cid}`, { durationMin: 0 })).status === 400);
await anna('PATCH', `/copies/${cid}`, { durationMin: 600 });
check('duration updated', (await anna('GET', `/books/${book.id}`)).data.copies.find(c => c.id === cid).durationMin === 600);
// gehört + fertig → Minuten in der Statistik, keine Seiten
const y = new Date().getFullYear();
await anna('PUT', `/books/${book.id}/reading`, { status: 'read', finishedAt: `${y}-01-15` });
const st = (await anna('GET', `/stats?year=${y}`)).data;
check('minutes counted', st.totals.minutes === 600, JSON.stringify(st.totals));
check('audio not in pages', st.perMonth[0].pages === 0 || !book.pages, JSON.stringify(st.perMonth[0]));
check('format group audio', st.formats.some(f => f.name === 'audio'));
// keine Leihanfrage auf Hörbücher
check('no request on audio', (await simon('POST', `/copies/${cid}/requests`, {})).status === 400);
console.log(`Hörbuch-Test: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
