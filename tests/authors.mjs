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
// Autor*innen folgen (Prüfung bei der DNB läuft im Hintergrund und ist hier nicht Teil des Tests)
const author = (await simon('GET', '/copies')).data[0].book.authors[0];
check('follow', (await simon('POST', '/authors/follow', { name: author })).status === 200);
check('follow idempotent', (await simon('POST', '/authors/follow', { name: author })).status === 200);
check('empty name rejected', (await simon('POST', '/authors/follow', { name: ' ' })).status === 400);
check('following list', (await simon('GET', '/authors/following')).data.includes(author));
let A = (await simon('GET', '/authors')).data;
check('authors page', A.follows.length === 1 && A.follows[0].name === author && Array.isArray(A.follows[0].releases), JSON.stringify(A));
check('suggestions exclude followed', !A.suggestions.some(s => s.name === author));
check('anna separate', (await anna('GET', '/authors/following')).data.length === 0);
check('unfollow', (await simon('POST', '/authors/unfollow', { name: author })).status === 200 && (await simon('GET', '/authors/following')).data.length === 0);
await simon('POST', '/authors/follow', { name: author });
check('notifications still load', (await simon('GET', '/notifications')).status === 200);
console.log(`Autor*innen-Test: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
