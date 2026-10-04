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
// Leserunden: Simon lädt Anna ein, Beiträge mit Position, Spoilerschutz nach Lesefortschritt
const users = (await simon('GET', '/users')).data;
const annaId = users.find(u => u.username === 'anna').id, benId = users.find(u => u.username === 'ben').id;
const book = (await simon('GET', '/copies')).data.find(c => c.book.pages)?.book ?? (await simon('GET', '/copies')).data[0].book;
const pages = book.pages ?? 100;
await simon('PUT', `/books/${book.id}/reading`, { status: 'reading', progress: Math.round(pages * 0.5) });
await anna('PUT', `/books/${book.id}/reading`, { status: 'reading', progress: Math.round(pages * 0.1) });

let r = await simon('POST', '/reads', { bookId: book.id, memberIds: [annaId], note: 'Herbst-Runde' });
check('read created', r.status === 200 && r.data.id, JSON.stringify(r));
const id = r.data.id;
check('anna invited', JSON.stringify((await anna('GET', '/notifications')).data).includes('buddy_invite'));
check('ben not member', (await ben('GET', `/reads/${id}`)).status === 404);
check('list for book', (await anna('GET', `/reads?book=${book.id}`)).data.some(x => x.id === id && x.members.length === 2));

// Simon schreibt bei 40 % (über die Seite, wenn vorhanden) – Anna steht bei 10 %
const p40 = book.pages ? { page: Math.round(pages * 0.4) } : { percent: 40 };
r = await simon('POST', `/reads/${id}/posts`, { text: 'Die Wendung!', ...p40 });
check('post created at ~40%', r.status === 200 && Math.abs(r.data.position - 40) <= 1, JSON.stringify(r.data));
const early = (await simon('POST', `/reads/${id}/posts`, { text: 'Guter Anfang', percent: 5 })).data.id;
let A = (await anna('GET', `/reads/${id}`)).data;
const locked = A.posts.find(p => p.position >= 39);
check('spoiler hidden for anna', locked?.locked === true && locked.text === null, JSON.stringify(A.posts));
check('early post visible', A.posts.find(p => p.id === early)?.text === 'Guter Anfang');
check('posts sorted by position', A.posts[0].id === early);
check('members show progress', A.members.find(m => m.id === annaId).position === 10 && A.myPosition === 10, JSON.stringify(A.members));
// Anna liest weiter → Beitrag wird sichtbar
await anna('PUT', `/books/${book.id}/reading`, { progress: Math.round(pages * 0.6) });
A = (await anna('GET', `/reads/${id}`)).data;
check('unlocked after progress', A.posts.find(p => p.text === 'Die Wendung!')?.locked === false);
// Anna schreibt ohne Position → eigener Stand (60 %); Simon (50 %) sieht es nicht
await anna('POST', `/reads/${id}/posts`, { text: 'Ab hier wird es wild' });
const S = (await simon('GET', `/reads/${id}`)).data;
check('own-progress position hides from simon', S.posts.find(p => p.user.id === annaId)?.locked === true);
check('empty text rejected', (await anna('POST', `/reads/${id}/posts`, { text: ' ' })).status === 400);
// Rechte
const annaPost = S.posts.find(p => p.user.id === annaId).id;
check('anna cannot delete simon post', (await anna('DELETE', `/reads/${id}/posts/${early}`)).status === 404);
check('owner deletes any post', (await simon('DELETE', `/reads/${id}/posts/${annaPost}`)).status === 200);
check('member cannot add', (await anna('POST', `/reads/${id}/members`, { userId: benId })).status === 404);
check('owner adds ben', (await simon('POST', `/reads/${id}/members`, { userId: benId })).status === 200 && (await ben('GET', `/reads/${id}`)).status === 200);
check('ben leaves', (await ben('DELETE', `/reads/${id}/members/${benId}`)).status === 200 && (await ben('GET', `/reads/${id}`)).status === 404);
check('owner cannot leave', (await simon('DELETE', `/reads/${id}/members/${(await simon('GET', '/me')).data.id}`)).status === 400);
check('unseen counter', (await simon('GET', '/reads')).data.find(x => x.id === id).unseen === 0);
check('delete read', (await anna('DELETE', `/reads/${id}`)).status === 404 && (await simon('DELETE', `/reads/${id}`)).status === 200);
// für Überlauf-Audit/Screenshots eine Runde stehen lassen (Simon 50 %, Anna 60 %, ein verdeckter Beitrag für Simon)
const keep = (await simon('POST', '/reads', { bookId: book.id, memberIds: [annaId, benId], note: 'Ein Kapitel pro Woche, Treffen sonntags', endsAt: '2026-12-01' })).data.id;
await simon('POST', `/reads/${keep}/posts`, { text: 'Der Anfang zieht sich ein bisschen, aber die Figuren gefallen mir.', percent: 8 });
await anna('POST', `/reads/${keep}/posts`, { text: 'Ab der Mitte konnte ich nicht mehr aufhören!', percent: 55 });
await anna('POST', `/reads/${keep}/posts`, { text: 'Das Ende hat mich umgehauen.', percent: 58 });
console.log(`Leserunden-Test: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
