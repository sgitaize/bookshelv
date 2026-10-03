// Iteration 9: Booky-Import, Import rückgängig machen, Lesedaten nachträglich ändern (läuft nach lists.mjs)
import { parseCsv, convert } from '../web/src/lib/importers.ts';
const base = 'http://localhost:3999/api';
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? ok++ : (fail++, console.log('✗', n, x)); };
let cookie = '';
const req = async (m, u, b) => {
  const r = await fetch(base + u, { method: m, headers: { ...(m !== 'GET' ? { 'Content-Type': 'application/json' } : {}), cookie }, body: m !== 'GET' ? JSON.stringify(b ?? {}) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
};
await req('POST', '/login', { username: 'simon', password: 'geheim1234' });

// echte Booky-Struktur (eine Zeile je Buch und Liste), 2000-01-01 = Datum unbekannt
const csv = 'isbn,title,contributors,list_name,is_default,list_created_at,entry_created_at\n'
  + "9783847901846,Babel,Rebecca F. Kuang,12 für '26,False,2025-12-21 23:56:31,2025-12-22 00:02:26\n"
  + '9783847901846,Babel,Rebecca F. Kuang,finished,True,2025-01-24 15:41:08,2025-10-24 18:00:00\n'
  + '9783847901846,Babel,Rebecca F. Kuang,favorite,True,2025-01-24 15:41:08,2025-10-24 18:01:00\n'
  + '9783462005011,Die Lücken,Shida Bazyar,finished,True,2025-01-24 15:41:08,2000-01-01 01:00:00\n'
  + '9783328604495,Trotzdem zuhause,Tupoka Ogette,wishlist,True,2025-01-24 15:41:08,2026-09-02 20:17:57\n'
  + '9783446284135,Spielen,Karen Köhler,did_not_finish,True,2026-01-29 19:34:18,2026-06-28 23:08:07\n'
  + '9783442763559,DAISY,Melanie Raabe,want_to_read,True,2025-01-24 15:41:08,2026-08-28 07:23:15\n';
const bk = convert(parseCsv(csv));
const by = t => bk.items.find(i => i.title.startsWith(t));
check('booky detected', bk.source === 'booky' && bk.items.length === 5, JSON.stringify(bk));
check('booky read date + fav + list', by('Babel').status === 'read' && by('Babel').finishedAt === '2025-10-24' && by('Babel').favorite && by('Babel').lists[0].name === "12 für '26");
check('booky unknown date', by('Die Lücken').status === 'read' && !by('Die Lücken').finishedAt && by('Die Lücken').dateUnknown);
check('booky wishlist/dnf/want', by('Trotzdem').status === 'want' && by('Spielen').status === 'dnf' && by('DAISY').lists[0].name === 'Will ich lesen');

const copiesBefore = (await req('GET', '/copies')).data.length;
const listsBefore = (await req('GET', '/lists')).data.length;
const wishBefore = (await req('GET', '/wishlist')).data.length;
const imp = (await req('POST', '/imports', { source: 'Booky', filename: 'booky.csv', total: bk.items.length })).data.id;
// Babel + Spielen stehen im Regal
const items = bk.items.map(i => ({ ...i, owned: ['Babel', 'Spielen'].includes(i.title) }));
let r = await req('POST', '/import', { items, options: { copies: 'owned', conflict: 'mine' }, importId: imp });
check('booky import ok', r.status === 200 && r.data.results.every(x => x.result === 'ok'), JSON.stringify(r.data));
const res = r.data.results;
const id = t => res.find(x => x.title.startsWith(t))?.bookId;
const babel = (await req('GET', `/books/${id('Babel')}`)).data;
check('read date from booky', babel.reading.status === 'read' && babel.reading.finishedAt === '2025-10-24' && babel.reading.favorite);
const luecken = (await req('GET', `/books/${id('Die L')}`)).data;
check('unknown date stays empty', luecken.reading.status === 'read' && luecken.reading.finishedAt === null, JSON.stringify(luecken.reading));
check('copies only for owned', (await req('GET', '/copies')).data.length === copiesBefore + 2);
const lists = (await req('GET', '/lists')).data;
const l12 = lists.find(x => x.name === "12 für '26");
check('lists created', l12 && lists.some(x => x.name === 'Will ich lesen'));
const l12d = (await req('GET', `/lists/${l12.id}`)).data;
check('list dates from file', l12d.createdAt === '2025-12-21 23:56:31' && l12d.items[0].addedAt === '2025-12-22 00:02:26', JSON.stringify([l12d.createdAt, l12d.items[0]?.addedAt]));
check('wishlist', (await req('GET', '/wishlist')).data.length === wishBefore + 1);
let hist = (await req('GET', '/imports')).data;
check('import history', hist[0].id === imp && hist[0].source === 'Booky' && hist[0].changes.copies.added === 2 && hist[0].changes.list_items.added === 2, JSON.stringify(hist[0]));
check('timeline shows read date', (await req('GET', '/history?types=finished')).data.events.some(e => e.book.id === id('Babel') && e.date === '2025-10-24'));

// Feed zeitlich korrekt: nichts aus dem Import steht als „heute“ drin
const today = new Date().toISOString().slice(0, 10);
const feed = (await req('GET', '/feed?scope=me&limit=100')).data.items;
const imported = new Set(res.map(x => x.bookId));
const fromImport = feed.filter(f => imported.has(f.book.id));
check('feed has imported events in the past', fromImport.some(f => f.type === 'finished' && f.ts.startsWith('2025-10-24')) && fromImport.some(f => f.type === 'added' && f.ts.startsWith('2025-10-24')), JSON.stringify(fromImport.map(f => [f.type, f.ts])));
check('feed has nothing from import dated today', fromImport.every(f => !f.ts.startsWith(today)), JSON.stringify(fromImport.filter(f => f.ts.startsWith(today)).map(f => [f.type, f.book.title])));
// Goodreads-Zeile mit Bewertung, aber ohne Datum: Bewertung still (nicht „heute bewertet“), gelesen ohne Datum
const imp2 = (await req('POST', '/imports', { source: 'Test', total: 1 })).data.id;
r = await req('POST', '/import', { importId: imp2, items: [{ title: 'Ohne Datum gelesen', authors: ['Jemand Testperson'], status: 'read', rating: 4 }], options: { copies: 'all' } });
const nd = r.data.results[0].bookId;
check('read without date stays undated', (await req('GET', `/books/${nd}`)).data.reading.finishedAt === null);
check('undated import not in feed', !(await req('GET', '/feed?scope=me&limit=100')).data.items.some(f => f.book.id === nd));
await req('POST', `/imports/${imp2}/undo`);

// --- Lesedaten ändern ---
check('fav toggle keeps unknown date', (await req('PUT', `/books/${id('Die L')}/reading`, { favorite: true })).data.finishedAt === null);
r = await req('PUT', `/books/${id('Die L')}/reading`, { finishedAt: '2024-05-01', startedAt: '2024-04-20' });
check('set dates later', r.data.finishedAt === '2024-05-01' && r.data.startedAt === '2024-04-20' && r.data.status === 'read');
check('end before start rejected', (await req('PUT', `/books/${id('Die L')}/reading`, { finishedAt: '2024-04-01', startedAt: '2024-04-20' })).status === 400);
check('future rejected', (await req('PUT', `/books/${id('Die L')}/reading`, { finishedAt: '2999-01-01' })).status === 400);
check('clear date', (await req('PUT', `/books/${id('Die L')}/reading`, { finishedAt: null })).data.finishedAt === null);
// manuell eintragen mit Datum
const man = (await req('POST', '/books', { title: 'Ein Test-Buch zum Datum', authors: ['Testerin'] })).data;
await req('POST', '/copies', { bookId: man.id, format: 'print', readStatus: 'read', finishedAt: '2023-07-14' });
check('copy with read date', (await req('GET', `/books/${man.id}`)).data.reading.finishedAt === '2023-07-14');

// --- Rückgängig ---
r = await req('POST', `/imports/${imp}/undo`);
check('undo ok', r.status === 200 && r.data.reverted > 0, JSON.stringify(r.data));
check('undo removes copies (keeps manual one)', (await req('GET', '/copies')).data.length === copiesBefore + 1);
check('undo removes lists', (await req('GET', '/lists')).data.length === listsBefore);
check('undo removes wishlist', (await req('GET', '/wishlist')).data.length === wishBefore);
const after = await req('GET', `/books/${id('Babel')}`);
check('undo resets reading', after.status === 404 || after.data.reading.status === 'unread', JSON.stringify(after.data?.reading));
check('undo twice rejected', (await req('POST', `/imports/${imp}/undo`)).status === 409);
check('history marks undone', (await req('GET', '/imports')).data[0].undoneAt !== null);
check('import into undone rejected', (await req('POST', '/import', { items: [], importId: imp })).status === 404);
console.log(`Booky/Rückgängig/Datum-Test: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) process.exitCode = 1;
