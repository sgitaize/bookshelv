// Iteration 8: Top 5, Leselisten, Aktivitätsfeed, Export, Import mit Abgleich (läuft nach extras.mjs)
import { parseCsv, convert } from '../web/src/lib/importers.ts';
const base = 'http://localhost:3999/api';
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? ok++ : (fail++, console.log('✗', n, x)); };
function client() {
  let cookie = '';
  return async (method, url, body, raw = false) => {
    const json = method !== 'GET';
    const res = await fetch(base + url, { method, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), cookie }, body: json ? JSON.stringify(body ?? {}) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    if (raw) return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
}
const simon = client(), anna = client();
await simon('POST', '/login', { username: 'simon', password: 'geheim1234' });
await anna('POST', '/login', { username: 'anna', password: 'geheim1234' });
const simonId = (await simon('GET', '/me')).data.id;
const mine = (await simon('GET', '/me/books')).data;
check('my books for picker', mine.length >= 2 && mine[0].status === 'read', JSON.stringify(mine.slice(0, 2)));
const shadow = mine.find(x => x.book.title === 'Der Schatten des Windes').book.id;
const other = mine.find(x => x.book.id !== shadow).book.id;

// --- Top 5 ---
check('top rejects 6', (await simon('PUT', '/me/top', { bookIds: [1, 2, 3, 4, 5, 6] })).status === 400);
check('top rejects duplicates', (await simon('PUT', '/me/top', { bookIds: [shadow, shadow] })).status === 400);
let r = await simon('PUT', '/me/top', { bookIds: [other, shadow] });
check('top saved in order', r.status === 200 && r.data[0].id === other && r.data[1].id === shadow, JSON.stringify(r.data));
let p = (await anna('GET', `/users/${simonId}/profile`)).data;
check('profile shows top', p.top.length === 2 && p.top[0].id === other);
await simon('PUT', '/me/top', { bookIds: [shadow] });
check('top replaced', (await simon('GET', '/me/top')).data.length === 1);
check('reading change keeps top', (await simon('PUT', `/books/${shadow}/reading`, { favorite: true })).status === 200 && (await simon('GET', '/me/top')).data[0]?.id === shadow);

// --- Leselisten ---
r = await simon('POST', '/lists', { name: 'Herbst 26', description: 'Für lange Abende', bookId: shadow });
check('list created', r.status === 200 && r.data.id);
const herbst = r.data.id;
check('list needs name', (await simon('POST', '/lists', { name: ' ' })).status === 400);
check('add to list', (await simon('PUT', `/lists/${herbst}/books/${other}`, {})).status === 200);
let l = (await anna('GET', `/lists/${herbst}`)).data;
check('friend sees public list', l.items.length === 2 && l.items[0].book.id === shadow && !l.mine, JSON.stringify(l));
check('friend cannot edit', (await anna('PUT', `/lists/${herbst}/books/${other}`, {})).status === 404);
await simon('PUT', `/lists/${herbst}/order`, { bookIds: [other, shadow] });
check('reorder', (await simon('GET', `/lists/${herbst}`)).data.items[0].book.id === other);
r = await simon('POST', '/lists', { name: 'Geheim', visibility: 'private' });
const secret = r.data.id;
check('private list hidden', (await anna('GET', `/lists/${secret}`)).status === 404);
let ul = (await anna('GET', `/users/${simonId}/lists`)).data;
check('user lists exclude private', ul.length === 1 && ul[0].name === 'Herbst 26' && ul[0].count === 2 && ul[0].preview.length === 2, JSON.stringify(ul));
check('own lists include private', (await simon('GET', '/lists')).data.length === 2);
let bl = (await simon('GET', `/books/${shadow}/lists`)).data;
check('book lists flags', bl.mine.find(x => x.id === herbst).has === true && bl.mine.find(x => x.id === secret).has === false);
check('others lists of book', (await anna('GET', `/books/${shadow}/lists`)).data.others.some(x => x.id === herbst));
await simon('DELETE', `/lists/${herbst}/books/${shadow}`);
check('remove from list', (await simon('GET', `/lists/${herbst}`)).data.items.length === 1);
await simon('PUT', `/lists/${herbst}/books/${shadow}`, {});

// --- Feed ---
let f = (await anna('GET', '/feed?limit=100')).data.items;
check('feed has listed + added', f.some(x => x.type === 'listed' && x.list.name === 'Herbst 26') && f.some(x => x.type === 'added'), JSON.stringify(f.map(x => x.type)));
check('feed hides private list', !f.some(x => x.type === 'listed' && x.list.name === 'Geheim'));
check('friends scope excludes self', f.every(x => x.user.username !== 'anna'));
const meFeed = (await simon('GET', '/feed?scope=me&limit=100')).data.items;
check('me scope', meFeed.length > 0 && meFeed.every(x => x.user.id === simonId));
check('me sees own private review', meFeed.some(x => x.type === 'reviewed' && x.book.id === shadow));
const bookFeed = (await anna('GET', `/feed?book=${shadow}`)).data.items;
check('book history', bookFeed.length > 0 && bookFeed.every(x => x.book.id === shadow) && bookFeed.some(x => x.type === 'finished'), JSON.stringify(bookFeed.map(x => x.type)));
check('book history hides private review', !bookFeed.some(x => x.type === 'reviewed' && x.user.id === simonId));
check('user feed', (await anna('GET', `/feed?user=${simonId}`)).data.items.every(x => x.user.id === simonId));

// --- Export ---
let e = await simon('GET', '/me/export.csv?format=goodreads', null, true);
const gr = convert(parseCsv(e.text));
check('goodreads export roundtrip', e.type.includes('text/csv') && gr.source === 'goodreads' && gr.items.some(i => i.isbn === '9783518456576' && i.status === 'read' && i.rating === 5 && i.lists.includes('herbst-26')), JSON.stringify(gr.items[0]));
e = await simon('GET', '/me/export.csv?format=storygraph', null, true);
check('storygraph export roundtrip', convert(parseCsv(e.text)).source === 'storygraph');
e = await simon('GET', '/me/export.csv?format=simple', null, true);
const simple = convert(parseCsv(e.text));
check('simple export roundtrip', simple.source === 'bookshelv' && simple.items.some(i => i.title === 'Der Schatten des Windes' && i.lists.includes('Herbst 26') && i.finishedAt === '2024-03-17'), JSON.stringify(simple.items[0]));
check('json export has lists', (await simon('GET', '/me/export')).data.lists.length === 2);

// --- Fremd-App (Booky-ähnlich, Semikolon, 10er-Skala, deutsches Datum) + Abgleich ---
const booky = 'Titel;Autor;ISBN;Status;Bewertung;Gelesen am;Notizen;Sammlungen\n'
  + '"Der Schatten des Windes";Carlos Ruiz Zafón;978-3-518-45657-6;Gelesen;6;20.04.2024;Anders gelesen;"Urlaub, Herbst 26"\n'
  + 'Neu hier;Jemand;;Möchte ich lesen;;;;\n';
const bk = convert(parseCsv(booky));
check('booky parsed', bk.source === 'generic' && bk.items[0].rating === 3 && bk.items[0].finishedAt === '2024-04-20' && bk.items[1].status === 'want' && bk.items[0].lists.length === 2, JSON.stringify(bk.items));
r = await simon('POST', '/import', { items: bk.items, options: { conflict: 'ask', copies: 'none' } });
const res0 = r.data.results[0];
check('conflicts reported', res0.result === 'conflict' && ['rating', 'finishedAt', 'review'].every(fl => res0.conflicts.some(c => c.field === fl)), JSON.stringify(res0));
check('ask keeps mine', (await simon('GET', `/books/${shadow}/reviews`)).data.reviews.find(x => x.mine).rating === 5);
check('lists merged by name', (await simon('GET', '/lists')).data.some(x => x.name === 'Urlaub') && (await simon('GET', '/lists')).data.filter(x => x.name === 'Herbst 26').length === 1);
r = await simon('POST', '/import', { items: [{ ...bk.items[0], resolve: ['rating'] }], options: { conflict: 'mine', copies: 'none' } });
let rev = (await simon('GET', `/books/${shadow}/reviews`)).data.reviews.find(x => x.mine);
check('resolve takes rating only', rev.rating === 3 && rev.text !== 'Anders gelesen', JSON.stringify(rev));
r = await simon('POST', '/import', { items: [bk.items[0]], options: { conflict: 'theirs', copies: 'none' } });
rev = (await simon('GET', `/books/${shadow}/reviews`)).data.reviews.find(x => x.mine);
const det = (await simon('GET', `/books/${shadow}`)).data;
check('theirs takes all', rev.text === 'Anders gelesen' && det.reading.finishedAt === '2024-04-20', JSON.stringify([rev.text, det.reading]));
r = await simon('POST', '/import', { items: [bk.items[0]], options: { conflict: 'ask', copies: 'none' } });
check('no conflict after merge', r.data.results[0].result === 'exists', JSON.stringify(r.data.results[0]));

// --- Löschen ---
check('friend cannot delete', (await anna('DELETE', `/lists/${herbst}`)).status === 404);
check('delete list', (await simon('DELETE', `/lists/${secret}`)).status === 200 && (await simon('GET', `/lists/${secret}`)).status === 404);
console.log(`Listen/Top5/Feed/Export-Test: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) process.exitCode = 1;
