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
// Reihen: von Hand setzen, Reihenfolge, nächster Band, meine Reihen
const books = [...new Map((await simon('GET', '/copies')).data.map(c => [c.book.id, c.book])).values()].slice(0, 3);
check('3 books for series', books.length === 3, books.length);
const S = 'Testreihe der Wächter';
for (const [i, b] of books.entries()) {
  const r = await simon('PUT', `/books/${b.id}/series`, { name: i === 2 ? S.toUpperCase() : S, index: i === 2 ? '2,5' : String(i + 1) });
  check(`set series ${i}`, r.status === 200 && r.data.series && r.data.seriesIndex === (i === 2 ? 2.5 : i + 1), JSON.stringify(r.data));
}
check('bad index rejected', (await anna('PUT', `/books/${books[0].id}/series`, { name: S, index: 'x' })).status === 400);
await simon('PUT', `/books/${books[0].id}/reading`, { status: 'read' });
await simon('PUT', `/books/${books[1].id}/reading`, { status: 'read' });
await simon('PUT', `/books/${books[2].id}/reading`, { status: 'unread' });
let r = (await simon('GET', `/series?name=${encodeURIComponent(S.toLowerCase())}`)).data;
check('series case-insensitive, sorted', r.books.length === 3 && r.books.map(b => b.index).join() === '1,2,2.5', JSON.stringify(r.books.map(b => b.index)));
check('next is 2.5', r.next?.id === books[2].id, JSON.stringify(r.next));
check('owned flag', r.books.every(b => b.owned));
check('anna sees friends have it', (await anna('GET', `/series?name=${encodeURIComponent(S)}`)).data.books[0].friends >= 1);
const mine = (await simon('GET', '/me/series')).data.find(x => x.name.toLowerCase() === S.toLowerCase());
check('my series', mine && mine.total === 3 && mine.read === 2 && mine.next?.id === books[2].id, JSON.stringify(mine));
check('book detail has series', (await simon('GET', `/books/${books[0].id}`)).data.book.series === S);
// Reihe entfernen
r = await simon('PUT', `/books/${books[2].id}/series`, { name: '' });
check('clear series', r.data.series === null && r.data.seriesIndex === null);
await simon('PUT', `/books/${books[2].id}/series`, { name: S, index: 2.5 });
console.log(`Reihen-Test: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
