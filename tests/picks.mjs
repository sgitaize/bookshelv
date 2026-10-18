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

console.log(`Vorschlag/Ziel/Mehrfach/Hinweise/Melden-Test: ${ok} ok, ${fail} fehlgeschlagen`);
