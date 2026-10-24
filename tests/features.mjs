// Sprache je Buch, Besitz unklar, Wunschliste im Listen-Dialog, Sprachen der Bibliothek (Simon 2026-10-12)
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
const simon = client(), anna = client();
await simon('POST', '/login', { username: 'simon', password: 'geheim1234' });
await anna('POST', '/login', { username: 'anna', password: 'geheim1234' });
const simonId = (await simon('GET', '/me')).data.id;

// eigenes Buch fürs Regal anlegen (manuell, ohne ISBN → Sprache unbekannt)
const book = (await simon('POST', '/books', { title: 'Cien años de soledad', authors: ['Gabriel García Márquez'] })).data;
const bid = book.id ?? book.book?.id;
const cp = (await simon('POST', '/copies', { bookId: bid, format: 'print', readStatus: 'unread' })).data.id;
let shelf = (await simon('GET', '/copies')).data;
let it = shelf.find(x => x.book.id === bid);
check('shelf has language + unsure', it && it.language === 'unknown' && it.unsure === false, JSON.stringify(it));
let d = (await simon('GET', `/books/${bid}`)).data;
check('detail language auto', d.language?.auto === 'unknown' && d.language.mine === null, JSON.stringify(d.language));

// Sprache setzen (auch für mehrere), zurück auf automatisch, ungültig
check('set language', (await simon('PUT', '/me/languages', { bookIds: [bid], language: 'es' })).status === 200);
it = (await simon('GET', '/copies')).data.find(x => x.book.id === bid);
check('shelf shows own language', it.language === 'es');
check('detail own language', (await simon('GET', `/books/${bid}`)).data.language.mine === 'es');
check('other person unaffected', (await anna('GET', `/books/${bid}`)).data.language.mine === null);
check('invalid language', (await simon('PUT', '/me/languages', { bookIds: [bid], language: 'Spanisch' })).status === 400);
check('no ids', (await simon('PUT', '/me/languages', { language: 'de' })).status === 400);

// Statistik: Sprachen der Bibliothek, gelesene Bücher mit eigener Sprache
let st = (await simon('GET', '/stats')).data;
const es = st.library?.languages.find(l => l.name === 'es');
check('library languages', es && es.n >= 1 && es.ids.includes(bid) && typeof es.read === 'number', JSON.stringify(st.library));
await simon('PUT', `/books/${bid}/reading`, { status: 'read', finishedAt: '2026-10-01' });
st = (await simon('GET', '/stats?year=2026')).data;
check('read stats use own language', st.languages.some(l => l.name === 'es' && l.ids.includes(bid)), JSON.stringify(st.languages));
check('library read count', (await simon('GET', '/stats')).data.library.languages.find(l => l.name === 'es').read >= 1);
check('reset language', (await simon('PUT', '/me/languages', { bookIds: [bid], language: null })).status === 200
  && (await simon('GET', `/books/${bid}`)).data.language.mine === null);

// Massen-Bearbeitung der Exemplare: Bindung, Farbschnitt, Format (bei Druck + E-Book bleibt das Format)
let rb = await simon('PUT', '/me/copies', { copyIds: [cp], binding: 'hardcover', sprayedEdges: true });
let cc = (await simon('GET', '/copies')).data.find(x => x.id === cp);
check('bulk binding + edges', rb.data?.changed === 1 && cc.binding === 'hardcover' && cc.sprayedEdges === true, JSON.stringify([rb.data, cc]));
check('bulk nothing', (await simon('PUT', '/me/copies', { copyIds: [cp] })).status === 400);
check('bulk foreign copy ignored', (await anna('PUT', '/me/copies', { copyIds: [cp], binding: 'paperback' })).data?.changed === 0);
const eb = (await simon('POST', '/copies', { bookId: bid, format: 'ebook' })).data.id;
rb = await simon('PUT', '/me/copies', { copyIds: [cp, eb], format: 'audio' });
check('bulk format skips multi-copy books', rb.data?.skipped === 2 && (await simon('GET', '/copies')).data.find(x => x.id === cp).format === 'print', JSON.stringify(rb.data));
rb = await simon('PUT', '/me/copies', { copyIds: [cp, eb], sprayedEdges: false });
check('bulk edges only print', rb.data?.changed === 1 && (await simon('GET', '/copies')).data.find(x => x.id === cp).sprayedEdges === false, JSON.stringify(rb.data));
await simon('DELETE', `/copies/${eb}`, { mode: 'purge' });
rb = await simon('PUT', '/me/copies', { copyIds: [cp], format: 'ebook' });
cc = (await simon('GET', '/copies')).data.find(x => x.id === cp);
check('bulk format single copy', rb.data?.changed === 1 && cc.format === 'ebook' && cc.binding === null, JSON.stringify([rb.data, cc]));
await simon('PUT', '/me/copies', { copyIds: [cp], format: 'print' });

// Besitz unklar: Massen-Aktion, Exemplar-Bearbeitung, Freund*innen sehen es nicht
check('mark unsure', (await simon('PUT', '/me/unsure', { bookIds: [bid], unsure: true })).status === 200);
check('shelf unsure', (await simon('GET', '/copies')).data.find(x => x.book.id === bid).unsure === true);
check('detail copy unsure', (await simon('GET', `/books/${bid}`)).data.copies.find(c => c.id === cp).ownerUnsure === true);
const fr = (await anna('GET', `/users/${simonId}/shelf`)).data;
check('friend sees no unsure', !fr.copies || fr.copies.every(c => c.unsure === false), JSON.stringify(fr).slice(0, 200));
check('friend detail no unsure', (await anna('GET', `/books/${bid}`)).data.copies.every(c => !c.ownerUnsure));
await simon('PATCH', `/copies/${cp}`, { ownerUnsure: false });
check('patch copy sure', (await simon('GET', '/copies')).data.find(x => x.book.id === bid).unsure === false);
await simon('PATCH', `/copies/${cp}`, { notes: 'x' });
check('patch keeps unsure', (await simon('GET', '/copies')).data.find(x => x.book.id === bid).unsure === false);
check('anna cannot mark simons copies', (await anna('PUT', '/me/unsure', { bookIds: [bid], unsure: true })).status === 200
  && (await simon('GET', '/copies')).data.find(x => x.book.id === bid).unsure === false);

// Listen-Dialog: Wunschbücher erkennbar und als eigener Reiter
const wb = (await simon('POST', '/books', { title: 'Wunschbuch Zwölf', authors: ['W. Test'] })).data;
const wid = wb.id ?? wb.book?.id;
await simon('PUT', `/books/${wid}/wishlist`, {});
let mb = (await simon('GET', '/me/books?q=Wunschbuch%20Zw')).data;
check('picker marks wish', mb.length === 1 && mb[0].wish === true && mb[0].owned === false, JSON.stringify(mb));
mb = (await simon('GET', '/me/books?q=&wish=1')).data;
check('picker wish tab', mb.length >= 1 && mb.every(x => x.wish), JSON.stringify(mb.map(x => x.book.title)));
check('picker owned flag', (await simon('GET', '/me/books?q=Cien')).data[0]?.owned === true);
const list = (await simon('POST', '/lists', { name: 'Nächstes Jahr', visibility: 'private' })).data;
check('wish book into list', (await simon('PUT', `/lists/${list.id}/books/${wid}`, {})).status === 200
  && (await simon('GET', `/lists/${list.id}`)).data.items.some(x => x.book.id === wid));

// aufräumen: spätere Tests zählen Listen und Wunschliste
await simon('DELETE', `/lists/${list.id}`);
await simon('DELETE', `/books/${wid}/wishlist`);

console.log(`Sprache/Besitz/Wunschliste-Test: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) process.exitCode = 1;
