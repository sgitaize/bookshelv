// Freundschaften (Simon 2026-10-12): Anfragen, Annehmen, Sichtbarkeit nur für Freund*innen (läuft nach api.mjs)
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
const simon = client(), anna = client(), fritzi = client();
await simon('POST', '/login', { username: 'simon', password: 'geheim1234' });
await anna('POST', '/login', { username: 'anna', password: 'geheim1234' });
const annaId = (await anna('GET', '/me')).data.id;
const simonId = (await simon('GET', '/me')).data.id;

// neue Person per Einladung von Simon → mit Simon befreundet, mit Anna nicht
const inv = (await simon('POST', '/invites', {})).data;
check('register', (await fritzi('POST', '/register', { token: inv.token, username: 'fritzi', displayName: 'Fritzi', password: 'geheim1234' })).status === 200);
const fritziId = (await fritzi('GET', '/me')).data.id;
let users = (await fritzi('GET', '/users')).data;
check('invite = friends', users.find(u => u.id === simonId).relation === 'friend' && users.find(u => u.id === annaId).relation === 'none', JSON.stringify(users));
check('non-friend: no book count', users.find(u => u.id === annaId).copies === null && users.find(u => u.id === simonId).copies !== null);

// Fritzi hat ein Buch
const book = (await fritzi('POST', '/books', { title: 'Freundschaftsbuch', authors: ['Testerin'] })).data;
const fc = (await fritzi('POST', '/copies', { bookId: book.id, format: 'print', readStatus: 'reading' })).data;
await fritzi('PUT', `/books/${book.id}/wishlist`, {}).catch(() => {});

// Anna sieht nur die Profilkarte
let p = (await anna('GET', `/users/${fritziId}/profile`)).data;
check('profile card only', p.relation === 'none' && p.counts === null && p.averageRating === null && !p.shelfVisible && p.reading.length === 0, JSON.stringify(p));
check('shelf hidden', (await anna('GET', `/users/${fritziId}/shelf`)).status === 403);
check('wishlist hidden', (await anna('GET', `/users/${fritziId}/wishlist`)).status === 403);
check('stats hidden', (await anna('GET', `/users/${fritziId}/stats`)).status === 403);
check('lists hidden', (await anna('GET', `/users/${fritziId}/lists`)).data.length === 0);
check('feed hidden', !(await anna('GET', `/feed?user=${fritziId}`)).data.items.length);
check('copy hidden on book page', !(await anna('GET', `/books/${book.id}`)).data.copies.some(c => c.ownerId === fritziId));
check('loan request rejected', (await anna('POST', `/copies/${fc.id}/requests`, { message: 'hi' })).status === 404);
check('simon sees fritzi', (await simon('GET', `/users/${fritziId}/shelf`)).status === 200 && (await simon('GET', `/books/${book.id}`)).data.copies.some(c => c.ownerId === fritziId));

// Anfrage Anna → Fritzi
check('self request rejected', (await anna('POST', `/users/${annaId}/friend`)).status === 400);
let r = await anna('POST', `/users/${fritziId}/friend`);
check('request sent', r.data?.relation === 'outgoing');
check('request idempotent', (await anna('POST', `/users/${fritziId}/friend`)).data.relation === 'outgoing');
let n = (await fritzi('GET', '/notifications')).data;
check('request notification', n.items.some(i => i.type === 'friend_request' && i.actor?.id === annaId));
let reqs = (await fritzi('GET', '/friends/requests')).data;
check('incoming listed', reqs.incoming.length === 1 && reqs.incoming[0].userId === annaId && (await anna('GET', '/friends/requests')).data.outgoing[0].userId === fritziId);
check('relation incoming', (await fritzi('GET', `/users/${annaId}/profile`)).data.relation === 'incoming');
// zurückziehen räumt die Glocke
await anna('DELETE', `/users/${fritziId}/friend`);
n = (await fritzi('GET', '/notifications')).data;
check('withdraw clears notification', !n.items.some(i => i.type === 'friend_request') && !(await fritzi('GET', '/friends/requests')).data.incoming.length);
// erneut anfragen, Fritzi nimmt an (POST auf die Gegenanfrage)
await anna('POST', `/users/${fritziId}/friend`);
r = await fritzi('POST', `/users/${annaId}/friend`);
check('accept', r.data.relation === 'friend' && (await anna('GET', `/users/${fritziId}/profile`)).data.relation === 'friend');
check('accepted notification', (await anna('GET', '/notifications')).data.items.some(i => i.type === 'friend_accepted' && i.actor?.id === fritziId));
check('requests cleared', !(await fritzi('GET', '/friends/requests')).data.incoming.length);
p = (await anna('GET', `/users/${fritziId}/profile`)).data;
check('friend sees profile', p.counts?.books === 1 && p.shelfVisible && p.reading.length === 1, JSON.stringify(p));
check('friend sees shelf', (await anna('GET', `/users/${fritziId}/shelf`)).status === 200);
check('friend sees copy', (await anna('GET', `/books/${book.id}`)).data.copies.some(c => c.ownerId === fritziId));
check('friend in feed', (await anna('GET', `/feed?user=${fritziId}`)).data.items.length > 0);
check('loan request ok', (await anna('POST', `/copies/${fc.id}/requests`, { message: 'darf ich?' })).status === 200);

// Freundschaft beenden
await fritzi('DELETE', `/users/${annaId}/friend`);
check('unfriend', (await anna('GET', `/users/${fritziId}/shelf`)).status === 403 && (await anna('GET', '/users')).data.find(u => u.id === fritziId).relation === 'none');
// Gegenseitige Anfrage gleichzeitig: zweite Anfrage nimmt die erste an
await anna('POST', `/users/${fritziId}/friend`);
check('cross request = friends', (await fritzi('POST', `/users/${annaId}/friend`)).data.relation === 'friend');
// Ablehnen: still, ohne Benachrichtigung
await fritzi('DELETE', `/users/${annaId}/friend`);
await fritzi('POST', `/users/${annaId}/friend`);
await anna('DELETE', `/users/${fritziId}/friend`);
check('decline', (await fritzi('GET', `/users/${annaId}/profile`)).data.relation === 'none' && !(await anna('GET', '/notifications')).data.items.some(i => i.type === 'friend_request' && i.actor?.id === fritziId));
check('unknown user 404', (await anna('POST', '/users/99999/friend')).status === 404);
console.log(`Freundschafts-Test: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) process.exitCode = 1;
