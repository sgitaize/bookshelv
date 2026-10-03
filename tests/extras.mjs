// Iteration 6: CSV-Import (Parser + API), Wunschliste, eigene Cover
import { parseCsv, convert } from '../web/src/lib/importers.ts';
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

// --- Parser ---
const goodreads = '﻿Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies\n'
  + '1,"Der Schatten des Windes (Barcelona, #1)",Carlos Ruiz Zafón,"Zafón, Carlos Ruiz",,"=""3518456571""","=""9783518456576""",5,4.3,Suhrkamp,Paperback,563,2005,2001,2024/03/17,2024/01/02,,,read,"Großartig,<br/>""wirklich"" toll",false,,1,1\n'
  + '2,Der Wüstenplanet,Frank Herbert,"Herbert, Frank",,"=""""","=""9783596906383""",0,4.2,Heyne,Kindle Edition,800,2016,1965,,2024/02/01,to-read,to-read (#1),to-read,,false,,0,0\n';
let g = convert(parseCsv(goodreads));
check('goodreads detected', g.source === 'goodreads' && g.items.length === 2);
check('goodreads isbn/title', g.items[0].isbn === '9783518456576' && g.items[0].title === 'Der Schatten des Windes', JSON.stringify(g.items[0]));
check('goodreads rating/date/review', g.items[0].rating === 5 && g.items[0].finishedAt === '2024-03-17' && g.items[0].review === 'Großartig,\n"wirklich" toll' && g.items[0].owned === true);
check('goodreads to-read ebook', g.items[1].status === 'want' && g.items[1].format === 'ebook' && g.items[1].rating === null);
const storygraph = 'Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?\n'
  + 'Das Alphabet der Knochen,Louise Welsh,,9783442476336,paperback,read,2025/05/01,2025/06/10,2025/06/01-2025/06/10,1,dark,medium,Plot,,,,,3.5,"Düster, gut",,,,Yes\n'
  + 'Frühling,Iwan Bunin,,9783596906383,digital,did-not-finish,2025/05/02,,,0,,,,,,,,,,,,,No\n';
let sg = convert(parseCsv(storygraph));
check('storygraph detected', sg.source === 'storygraph' && sg.items.length === 2);
check('storygraph fields', sg.items[0].rating === 3.5 && sg.items[0].owned && sg.items[0].binding === 'paperback' && sg.items[0].finishedAt === '2025-06-10');
check('storygraph dnf ebook', sg.items[1].status === 'dnf' && sg.items[1].format === 'ebook');
check('generic csv', convert(parseCsv('Titel;x\n')).items.length === 0 && convert(parseCsv('isbn,title\n9783257236965,Aphorismen\n')).items[0].isbn === '9783257236965');

// --- Import-API (gegen die laufende Testinstanz) ---
const simon = client();
await simon('POST', '/login', { username: 'simon', password: 'geheim1234' });
const before = (await simon('GET', '/copies')).data.length;
let r = await simon('POST', '/import', { items: g.items, options: { copies: 'owned', reviews: true, wishlist: true, visibility: 'private' } });
check('import ok', r.status === 200 && r.data.results.every(x => x.result === 'ok'), JSON.stringify(r.data));
const shadow = r.data.results[0].bookId;
check('owned copy created', (await simon('GET', '/copies')).data.length === before + 1);
const det = (await simon('GET', `/books/${shadow}`)).data;
check('read status + date', det.reading.status === 'read' && det.reading.finishedAt === '2024-03-17');
check('private review imported', (await simon('GET', `/books/${shadow}/reviews`)).data.reviews[0]?.visibility === 'private');
check('to-read on wishlist', (await simon('GET', '/wishlist')).data.some(w => w.book.id === r.data.results[1].bookId));
r = await simon('POST', '/import', { items: g.items, options: { copies: 'owned' } });
check('re-import idempotent', r.data.results.every(x => x.result === 'exists'), JSON.stringify(r.data.results));
r = await simon('POST', '/import', { items: [{ title: 'Ein Buch, das es nicht gibt', authors: ['Niemand'], status: 'read' }], options: { copies: 'all' } });
check('no-isbn book created manually', r.data.results[0].result === 'ok');

// --- Wunschliste ---
const wishBook = r.data.results[0].bookId;
check('wishlist add', (await simon('PUT', `/books/${wishBook}/wishlist`, { note: 'Geschenkidee' })).status === 200);
check('book shows wishlisted', (await simon('GET', `/books/${wishBook}`)).data.wishlisted === true);
const anna = client(); await anna('POST', '/login', { username: 'anna', password: 'geheim1234' });
const simonId = (await simon('GET', '/me')).data.id;
check('friend sees wishlist', (await anna('GET', `/users/${simonId}/wishlist`)).data.some(w => w.note === 'Geschenkidee'));
await simon('POST', '/copies', { bookId: wishBook, format: 'print' });
check('copy removes from wishlist', !(await simon('GET', '/wishlist')).data.some(w => w.book.id === wishBook));

// --- Cover ---
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
check('anna cannot replace cover', (await anna('POST', `/books/${shadow}/cover`, { image: png })).status === 403);
r = await simon('POST', `/books/${wishBook}/cover`, { image: png });
check('owner uploads cover', r.status === 200 && r.data.coverUrl?.includes('-own-'), JSON.stringify(r.data));
console.log(`Import/Wunsch/Cover-Test: ${ok} ok, ${fail} fehlgeschlagen`);
