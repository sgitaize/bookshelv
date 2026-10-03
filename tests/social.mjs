// Iteration 4: Profilbilder, Benachrichtigungen, Feed (läuft nach api.mjs/loans.mjs gegen dieselbe Instanz)
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
    return { status: res.status, data, res };
  };
}
const simon = client(), anna = client();
await simon('POST', '/login', { username: 'simon', password: 'geheim1234' });
await anna('POST', '/login', { username: 'anna', password: 'geheim1234' });
const annaId = (await anna('GET', '/me')).data.id;

// Profilbild
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
let r = await anna('POST', '/me/avatar', { image: png });
check('avatar upload', r.status === 200 && r.data.avatarUrl?.startsWith('/api/avatars/'));
const url = r.data.avatarUrl;
check('avatar in /me', (await anna('GET', '/me')).data.avatarUrl === url);
check('avatar in /users', (await simon('GET', '/users')).data.find(u => u.id === annaId).avatarUrl === url);
check('avatar served to users', (await fetch('http://localhost:3999' + url, { headers: { cookie: '' } })).status === 401);
const fake = 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64');
check('fake image rejected', (await anna('POST', '/me/avatar', { image: fake })).status === 400);
check('svg rejected', (await anna('POST', '/me/avatar', { image: 'data:image/svg+xml;base64,PHN2Zz4=' })).status === 400);

// Benachrichtigungen
await anna('POST', '/notifications/read');
const copy = (await simon('GET', '/copies')).data.find(c => !c.lent);
const loan = (await simon('POST', `/copies/${copy.id}/loans`, { borrowerId: annaId })).data;
let n = (await anna('GET', '/notifications')).data;
check('loan_new notification', n.unread === 1 && n.items[0].type === 'loan_new' && n.items[0].book?.id === copy.book.id, JSON.stringify(n.items[0]));
await anna('POST', `/loans/${loan.id}/return`);
n = (await simon('GET', '/notifications')).data;
check('loan_returned to lender', n.items.some(i => i.type === 'loan_returned' && i.actor?.id === annaId));
await anna('PUT', `/books/${copy.book.id}/review`, { rating: 4, text: 'Schön' });
const rev = (await simon('GET', `/books/${copy.book.id}/reviews`)).data.reviews.find(x => x.user.id === annaId);
await simon('POST', `/reviews/${rev.id}/comments`, { text: 'Finde ich auch' });
n = (await anna('GET', '/notifications')).data;
check('comment notification', n.items.some(i => i.type === 'comment' && i.book?.id === copy.book.id));
check('mark read', (await anna('POST', '/notifications/read')).data.unread === 0 && (await anna('GET', '/notifications/count')).data.unread === 0);
await anna('POST', `/reviews/${rev.id}/comments`, { text: 'Danke' });
check('no self-notification', (await anna('GET', '/notifications/count')).data.unread === 0);

// Verleih-Erinnerungen (bald fällig / überfällig) an beide Seiten, je Verleih nur einmal
const isoDay = d => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const due = (await simon('POST', `/copies/${copy.id}/loans`, { borrowerId: annaId, lentAt: isoDay(-10), dueAt: isoDay(1) })).data;
await anna('POST', '/notifications/read');
n = (await anna('GET', '/notifications')).data;
check('loan_due to borrower', n.items.some(i => i.type === 'loan_due' && i.refId === due.id), JSON.stringify(n.items.slice(0, 2)));
check('loan_due to lender', (await simon('GET', '/notifications')).data.items.some(i => i.type === 'loan_due' && i.refId === due.id && i.actor?.id === annaId));
await anna('GET', '/notifications/count');
check('loan_due once', (await anna('GET', '/notifications')).data.items.filter(i => i.type === 'loan_due' && i.refId === due.id).length === 1);
await anna('POST', `/loans/${due.id}/return`);

// Wunschliste: Freund*in stellt das Buch ins Regal → Benachrichtigung
const wb = (await simon('POST', '/books', { title: 'Wunschbuch für die Glocke', authors: ['Testerin'] })).data;
await anna('PUT', `/books/${wb.id}/wishlist`, {});
await anna('POST', '/notifications/read');
await simon('POST', '/copies', { bookId: wb.id, format: 'print', binding: 'paperback' });
n = (await anna('GET', '/notifications')).data;
check('wish_available', n.items.some(i => i.type === 'wish_available' && i.book?.id === wb.id), JSON.stringify(n.items[0]));
await simon('POST', '/copies', { bookId: wb.id, format: 'ebook' });
check('wish_available only once', (await anna('GET', '/notifications')).data.items.filter(i => i.type === 'wish_available' && i.book?.id === wb.id).length === 1);
const inv = (await simon('POST', '/invites', {})).data;
const carl = client();
await carl('POST', '/register', { token: inv.token, username: 'carl', password: 'geheim1234' });
check('invite_accepted', (await simon('GET', '/notifications')).data.items.some(i => i.type === 'invite_accepted'));

// Feed
let f = (await simon('GET', '/feed')).data.items;
check('feed has anna review', f.some(i => i.type === 'reviewed' && i.user.id === annaId && i.user.avatarUrl === url));
check('feed excludes own', f.every(i => i.user.displayName !== 'Simon'));
await anna('PATCH', '/me', { shelfVisible: false });
f = (await simon('GET', '/feed')).data.items;
check('private shelf hidden from feed', f.every(i => i.user.id !== annaId));
await anna('PATCH', '/me', { shelfVisible: true });
check('feed paging', (await simon('GET', '/feed?limit=1')).data.items.length <= 1);
check('avatar removed', (await anna('DELETE', '/me/avatar')).status === 200 && (await anna('GET', '/me')).data.avatarUrl === null);
console.log(`Social-Test: ${ok} ok, ${fail} fehlgeschlagen`);
