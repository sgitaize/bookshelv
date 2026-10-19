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

// ---------- Mehrfach gelesen ----------
const year = new Date().getFullYear();
const rb = await mk(mia, 'Lieblingsbuch', 300);
await mia('PUT', `/books/${rb}/reading`, { status: 'read', startedAt: '2023-01-02', finishedAt: '2023-02-01' });
await mia('PUT', `/books/${rb}/review`, { rating: 4, text: '', visibility: 'private' });
let rr = await mia('POST', `/books/${rb}/rereads`, { startedAt: `${year}-01-01`, finishedAt: `${year}-01-10`, rating: 5 });
check('reread add', rr.status === 200 && rr.data.length === 1 && rr.data[0].rating === 5, JSON.stringify(rr.data));
check('reread future 400', (await mia('POST', `/books/${rb}/rereads`, { finishedAt: '2999-01-01' })).status === 400);
check('reread end before start 400', (await mia('POST', `/books/${rb}/rereads`, { startedAt: `${year}-01-05`, finishedAt: `${year}-01-01` })).status === 400);
check('reread bad rating 400', (await mia('POST', `/books/${rb}/rereads`, { rating: 4.3 })).status === 400);
rr = await mia('POST', `/books/${rb}/rereads`, {});
check('reread ongoing', rr.data.length === 2 && rr.data[1].finishedAt === null && rr.data[1].startedAt, JSON.stringify(rr.data));
const ongoing = rr.data[1].id;
check('book detail rereads', (await mia('GET', `/books/${rb}`)).data.rereads.length === 2);
let st = (await mia('GET', `/stats?year=${year}`)).data;
// „Schon gelesen“ von oben zählt heute mit
check('reread counted this year', st.totals.books === 2 && st.totals.rereads === 1 && st.totals.avgRating === 5, JSON.stringify(st.totals));
st = (await mia('GET', '/stats')).data;
check('all years: two readings, one book', st.totals.books === 3 && st.perYear.length === 2 && st.authors[0].n === 3 && st.authors[0].ids.length === 2, JSON.stringify(st.perYear));
check('years list has reread year', st.years.includes(String(year)) && st.years.includes('2023'));
check('home counts reread', (await mia('GET', '/home')).data.counts.readThisYear === 2);
await mia("PATCH", `/rereads/${ongoing}`, { startedAt: `${year}-01-11`, finishedAt: `${year}-01-12` });
check('reread finished counts', (await mia('GET', `/stats?year=${year}`)).data.totals.books === 3);
check('foreign reread 404', (await simon('PATCH', `/rereads/${ongoing}`, { rating: 1 })).status === 404);
rr = await mia('DELETE', `/rereads/${ongoing}`);
check('reread delete', rr.data.length === 1);
const unreadBook = await mk(mia, 'Gleich nochmal', 100);
await mia('POST', `/books/${unreadBook}/rereads`, {});
check('reread marks first reading read', (await mia('GET', `/books/${unreadBook}`)).data.reading.status === 'read');
const exp = (await mia('GET', '/me/export.json')).data;
check('app export rereads', exp.items.find(i => i.title === 'Lieblingsbuch')?.app.rereads?.length === 1, JSON.stringify(exp.items.find(i => i.title === 'Lieblingsbuch')?.app));
check('gdpr export rereads', (await mia('GET', '/me/export')).data.rereads.length === 2);

// ---------- Leseziel ----------
check('no goal yet', (await mia('GET', `/goals/${year}`)).data === null && (await mia('GET', '/home')).data.goal === null);
let g = (await mia('PUT', `/goals/${year}`, { books: 10, pages: 5000 })).data;
// Mia hat dieses Jahr: „Schon gelesen“ (200 S.) und zwei Lektüren von „Lieblingsbuch“ (300 S.) → 2 nach dem Löschen der dritten
check('goal progress', g.books === 10 && g.pages === 5000 && g.done.books === 2 && g.done.pages === 500 && g.expected.books > 0, JSON.stringify(g));
check('goal on home', (await mia('GET', '/home')).data.goal?.done.books === 2);
check('goal in stats', (await mia('GET', `/stats?year=${year}`)).data.goal?.books === 10 && (await mia('GET', '/stats')).data.goal === null);
g = (await mia('PUT', `/goals/${year}`, { books: null, pages: '3000' })).data;
check('goal pages only', g.books === null && g.pages === 3000);
check('goal past year no pace', (await mia('PUT', '/goals/2023', { books: 1 })).data.expected === null && (await mia('GET', '/goals/2023')).data.done.books === 1);
check('goal bad values', (await mia('PUT', `/goals/${year}`, { books: -1 })).status === 400 && (await mia('GET', '/goals/abc')).status === 400);
check('goal removed', (await mia('PUT', `/goals/${year}`, {})).data === null && (await mia('GET', `/goals/${year}`)).data === null);
check('goal private', (await simon('GET', '/goals/2023')).data === null);

// ---------- Inhaltshinweise ----------
check('note tags list', (await mia('GET', '/content-notes/tags')).data.includes('violence'));
let cn = (await mia('PUT', `/books/${long}/content-notes`, { tags: ['violence', 'war', 'war'], note: 'Schlachtszenen ab Kapitel 4' })).data;
check('notes saved', cn.mine.tags.length === 2 && cn.tags.length === 2 && cn.notes[0]?.mine && cn.people === 1, JSON.stringify(cn));
check('notes bad tag 400', (await mia('PUT', `/books/${long}/content-notes`, { tags: ['gruselig'] })).status === 400);
await simon('PUT', `/books/${long}/content-notes`, { tags: ['war'] });
cn = (await simon('GET', `/books/${long}/content-notes`)).data;
check('notes counted across instance', cn.tags[0].tag === 'war' && cn.tags[0].n === 2 && cn.people === 2, JSON.stringify(cn.tags));
check('friend sees text', cn.notes.some(n => n.text === 'Schlachtszenen ab Kapitel 4' && n.user.displayName === 'mia'));
await simon('PATCH', '/admin/instance', { openRegistration: true });
const stranger = await (async () => { const cl = client(); await cl('POST', '/register', { username: 'fremd', displayName: 'Fremd', password: 'geheim1234' }); return cl; })();
const sn = (await stranger('GET', `/books/${long}/content-notes`)).data;
check('stranger sees tags, not text', sn?.tags.length === 2 && sn.notes.length === 0, JSON.stringify(sn));
// meiden: Cover verdeckt, kein Vorschlag
check('avoid empty', (await mia('GET', '/me/content-avoid')).data.books.length === 0);
await mia('PATCH', '/me', { prefs: { avoidNotes: 'war,unsinn' } });
check('avoid pref sanitized', (await mia('GET', '/me')).data.prefs.avoidNotes === 'war');
const av = (await mia('GET', '/me/content-avoid')).data;
check('avoid lists book', av.books.includes(long) && av.tags[0] === 'war', JSON.stringify(av));
check('avoided on book page', (await mia('GET', `/books/${long}/content-notes`)).data.avoided[0] === 'war');
for (let i = 0; i < 10; i++) if ((await mia('GET', '/home/next')).data.book?.id === long) { check('avoided never suggested', false); break; }
await mia('PATCH', '/me', { prefs: { avoidNotes: '' } });
check('avoid cleared', (await mia('GET', '/me/content-avoid')).data.books.length === 0);
cn = (await mia('PUT', `/books/${long}/content-notes`, { tags: [], note: '' })).data;
check('notes removed', cn.mine === null && cn.tags.length === 1);
check('gdpr export notes', Array.isArray((await simon('GET', '/me/export')).data.contentNotes));

// Zusammenführen (App → Konto): weitere Lektüren kommen mit, doppelte nicht, Rückgängig entfernt sie wieder
const item = { ...exp.items.find(i => i.title === 'Lieblingsbuch'), owned: true };
const leo = await fresh('leo');
let job = (await leo('POST', '/imports/jobs', { source: 'bookshelv-app', items: [item, item], options: { copies: 'owned', conflict: 'mine' } })).data;
for (let i = 0; i < 50 && (await leo('GET', `/imports/${job.id}`)).data.status === 'running'; i++) await new Promise(r => setTimeout(r, 200));
const leoBook = (await leo('GET', '/copies')).data.find(c => c.book.title === 'Lieblingsbuch')?.book.id;
check('merge rereads once', (await leo('GET', `/books/${leoBook}/rereads`)).data.length === 1, JSON.stringify((await leo('GET', `/imports/${job.id}`)).data));
await leo('POST', `/imports/${job.id}/undo`);
check('undo removes rereads', (await leo('GET', `/books/${leoBook}/rereads`)).data.length === 0);

// ---------- Melden, Blockieren, Push ----------
const http = await import('node:http');
const crypto = await import('node:crypto');
const pushes = [];
const fake = http.createServer((q, r) => { pushes.push({ url: q.url, auth: q.headers.authorization, ttl: q.headers.ttl }); r.writeHead(q.url.includes('gone') ? 410 : 201); r.end(); });
await new Promise(r => fake.listen(3990, r));
const miaId0 = (await mia('GET', '/me')).data.id;
const key = (await simon('GET', '/push/key')).data.key;
check('vapid key', typeof key === 'string' && Buffer.from(key, 'base64url').length === 65);
check('push bad endpoint', (await simon('POST', '/push/subscribe', { endpoint: 'https://evil.example/x' })).status === 400
  && (await simon('POST', '/push/subscribe', { endpoint: 'http://10.0.0.1/x' })).status === 400);
check('push subscribe', (await simon('POST', '/push/subscribe', { endpoint: 'http://localhost:3990/simon' })).status === 200);
await simon('POST', '/push/subscribe', { endpoint: 'http://localhost:3990/gone' });

// Mia schreibt eine Review, Leo kommentiert sie; Leo meldet Mias Review, Mia meldet Leos Kommentar
await mia('PUT', `/books/${long}/review`, { rating: 1, text: 'Unfreundlicher Text', visibility: 'instance' });
let rv = (await leo('GET', `/books/${long}/reviews`)).data.reviews.find(r => r.user.displayName === 'mia');
check('leo sees mia review', !!rv);
await leo('POST', `/reviews/${rv.id}/comments`, { text: 'Spam spam spam' });
const cm = (await mia('GET', `/books/${long}/reviews`)).data.reviews.find(r => r.mine).comments[0];
check('report own content 400', (await mia('POST', '/reports', { type: 'review', id: rv.id, reason: 'spam' })).status === 400);
check('report bad reason 400', (await leo('POST', '/reports', { type: 'review', id: rv.id, reason: 'langweilig' })).status === 400);
check('report missing 404', (await leo('POST', '/reports', { type: 'review', id: 999999, reason: 'spam' })).status === 404);
const rep = (await leo('POST', '/reports', { type: 'review', id: rv.id, reason: 'offensive', note: 'gemein' })).data;
check('report review', rep.ok && rep.id > 0);
check('report idempotent', (await leo('POST', '/reports', { type: 'review', id: rv.id, reason: 'offensive' })).data.id === rep.id);
await mia('POST', '/reports', { type: 'comment', id: cm.id, reason: 'spam' });
await mia('POST', '/reports', { type: 'user', id: (await leo('GET', '/me')).data.id, reason: 'other' });
check('reports admin only', (await mia('GET', '/admin/reports')).status === 403);
let reps = (await simon('GET', '/admin/reports')).data;
const rrv = reps.items.find(x => x.type === 'review');
check('admin sees reports', reps.open === 3 && rrv.excerpt === 'Unfreundlicher Text' && rrv.note === 'gemein' && rrv.reporter.displayName === 'leo' && rrv.href.startsWith('/book/'), JSON.stringify(reps).slice(0, 400));
check('admin notified', (await simon('GET', '/notifications')).data.items.filter(n => n.type === 'report_new').length >= 3);
await new Promise(r => setTimeout(r, 300));
const sp = pushes.filter(p => p.url === '/simon');
check('push sent to admin', sp.length >= 3 && sp[0].ttl === '86400', JSON.stringify(pushes.slice(0, 2)));
const [t, k] = sp[0].auth.replace('vapid ', '').split(', ').map(x => x.split('=').slice(1).join('='));
const [h, c, sig] = t.split('.');
const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(k, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(k, 'base64url').subarray(33).toString('base64url') }, format: 'jwk' });
check('vapid jwt valid', k === key && crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))
  && JSON.parse(Buffer.from(c, 'base64url')).aud === 'http://localhost:3990');
// abgelaufenes Abo (410) wird gelöscht – danach gehen keine Pushes mehr dorthin
const goneBefore = pushes.filter(p => p.url === '/gone').length;
await leo('POST', '/reports', { type: 'user', id: miaId0, reason: 'spam' });
await new Promise(r => setTimeout(r, 300));
check('gone subscription removed', goneBefore >= 1 && pushes.filter(p => p.url === '/gone').length === goneBefore, String(goneBefore));
// Admin löscht die Review, erledigt damit auch weitere Meldungen zum selben Ziel
check('resolve remove', (await simon('POST', `/admin/reports/${rrv.id}/resolve`, { action: 'remove' })).status === 200);
check('review deleted', !(await mia('GET', `/books/${long}/reviews`)).data.reviews.some(r => r.mine));
const rcm = reps.items.find(x => x.type === 'comment');
await simon('POST', `/admin/reports/${rcm.id}/resolve`, { action: 'dismiss' });
reps = (await simon('GET', '/admin/reports')).data;
check('open count after resolve', reps.open === 2 && (await simon('GET', '/admin/reports?all=1')).data.items.find(x => x.id === rrv.id).resolution === 'removed');
check('push unsubscribe', (await simon('POST', '/push/unsubscribe', { endpoint: 'http://localhost:3990/simon' })).data.ok === true);

// Blockieren: Mia blockiert Leo → keine Reviews/Kommentare mehr gegenseitig, keine Anfragen
const leoId = (await leo('GET', '/me')).data.id, miaId = (await mia('GET', '/me')).data.id;
await leo('PUT', `/books/${long}/review`, { rating: 3, text: 'Leos Meinung', visibility: 'instance' });
await mia('PUT', `/books/${long}/review`, { rating: 2, text: 'Mias Meinung', visibility: 'instance' });
check('block', (await mia('POST', `/users/${leoId}/block`)).data.blocked === true);
check('blocked reviews hidden', !(await mia('GET', `/books/${long}/reviews`)).data.reviews.some(r => r.user.id === leoId)
  && !(await leo('GET', `/books/${long}/reviews`)).data.reviews.some(r => r.user.id === miaId));
const miaRv = (await simon('GET', `/books/${long}/reviews`)).data.reviews.find(r => r.user.id === miaId);
check('blocked cannot comment', (await leo('POST', `/reviews/${miaRv.id}/comments`, { text: 'hallo' })).status === 404);
check('blocked no friend request', (await leo('POST', `/users/${miaId}/friend`)).status === 403);
check('profile shows blocked', (await mia('GET', `/users/${leoId}/profile`)).data.blocked === true && (await mia('GET', '/me/blocks')).data[0].id === leoId);
check('others still see both', (await simon('GET', `/books/${long}/reviews`)).data.reviews.filter(r => [leoId, miaId].includes(r.user.id)).length === 2);
await mia('DELETE', `/users/${leoId}/block`);
check('unblock', (await leo('GET', `/books/${long}/reviews`)).data.reviews.some(r => r.user.id === miaId) && (await mia('GET', '/me/blocks')).data.length === 0);
// Konto sperren über die Meldung
const rus = reps.items.find(x => x.type === 'user' && x.target.displayName === 'leo');
await simon('POST', `/admin/reports/${rus.id}/resolve`, { action: 'disable' });
check('disable via report', (await leo('GET', '/me')).status === 401);
// ---------- Push über ntfy, Pushover, Telegram ----------
const sent = [];
let tgUpdates = [];
const fake2 = http.createServer((q, r) => {
  let b = ''; q.on('data', d => (b += d)); q.on('end', () => {
    sent.push({ url: q.url, body: b, title: q.headers.title, click: q.headers.click });
    const json = o => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (q.url.endsWith('/getMe')) return json(q.url.includes('bad') ? { ok: false } : { ok: true, result: { username: 'bookshelv_test_bot' } });
    if (q.url.includes('/getUpdates')) return json({ ok: true, result: tgUpdates });
    if (q.url.startsWith('/pushover')) { r.writeHead(new URLSearchParams(b).get('user') === 'x'.repeat(30) ? 400 : 200); return r.end('{}'); }
    json({ ok: true });
  });
});
await new Promise(r => fake2.listen(3989, r));
let pc = (await mia('GET', '/push/channels')).data;
check('channels: only ntfy available', pc.available.ntfy && !pc.available.pushover && !pc.available.telegram && pc.channels.length === 0, JSON.stringify(pc));
check('ntfy bad urls', (await mia('PUT', '/push/channels/ntfy', { url: 'https://10.0.0.1/abcdefg' })).status === 400
  && (await mia('PUT', '/push/channels/ntfy', { url: 'http://ntfy.sh/abcdefg' })).status === 400
  && (await mia('PUT', '/push/channels/ntfy', { url: 'https://ntfy.sh/a' })).status === 400);
check('ntfy save', (await mia('PUT', '/push/channels/ntfy', { url: 'http://localhost:3990/ntfy-mia-topic' })).data[0]?.target === 'http://localhost:3990/ntfy-mia-topic');
check('pushover needs operator', (await mia('PUT', '/push/channels/pushover', { key: 'a'.repeat(30) })).status === 409);
check('push admin only', (await mia('GET', '/admin/push')).status === 403);
check('admin bad pushover token', (await simon('PATCH', '/admin/push', { pushoverToken: 'kurz' })).status === 400);
check('admin bad telegram token', (await simon('PATCH', '/admin/push', { telegramToken: '123:bad' + 'x'.repeat(30) })).status === 400
  && (await simon('GET', '/admin/push')).data.telegram === false);
let ap = (await simon('PATCH', '/admin/push', { pushoverToken: 'p'.repeat(30), telegramToken: '123:' + 'T'.repeat(35) })).data;
check('admin tokens set', ap.pushover && ap.telegram && ap.telegramBot === 'bookshelv_test_bot', JSON.stringify(ap));
check('tokens never returned', !JSON.stringify((await simon('GET', '/admin/push')).data).includes('ppppp'));
pc = (await mia('GET', '/push/channels')).data;
check('channels now available', pc.available.pushover && pc.available.telegram === 'bookshelv_test_bot');
check('pushover bad key', (await mia('PUT', '/push/channels/pushover', { key: 'zu-kurz' })).status === 400);
pc = (await mia('PUT', '/push/channels/pushover', { key: 'u'.repeat(30) })).data;
check('pushover masked', pc.find(c => c.kind === 'pushover').target === 'uuuu…uuu', JSON.stringify(pc));
// Telegram koppeln: Link mit Code, Bot bekommt „/start <code>“
const link = (await mia('POST', '/push/channels/telegram')).data.url;
const code = link?.split('start=')[1];
check('telegram link', link?.startsWith('https://t.me/bookshelv_test_bot?start=') && code);
check('telegram not yet linked', (await mia('POST', '/push/channels/telegram/check')).data.linked === false);
tgUpdates = [{ update_id: 7, message: { text: `/start ${code}`, chat: { id: 4242 } } }];
check('telegram linked', (await mia('POST', '/push/channels/telegram/check')).data.linked === true);
tgUpdates = [];
check('telegram welcome sent', sent.some(x => x.url.includes('/sendMessage') && x.body.includes('4242')));
// Test an alle drei, dann echte Benachrichtigung (Simon kommentiert nicht – Leo ist gesperrt; Freundschaftsanfrage von Simon)
sent.length = 0; pushes.length = 0;
let tr = (await mia('POST', '/push/test')).data.results;
check('test all channels', tr.length === 3 && tr.every(x => x.ok), JSON.stringify(tr));
check('ntfy got test', pushes.some(p => p.url === '/ntfy-mia-topic'));
check('pushover got test', sent.some(x => x.url === '/pushover' && new URLSearchParams(x.body).get('token') === 'p'.repeat(30)));
pushes.length = 0; sent.length = 0;
await mia('PUT', `/books/${long}/review`, { rating: 4, text: 'Push-Test', visibility: 'instance' });
const rvp = (await simon('GET', `/books/${long}/reviews`)).data.reviews.find(r => r.user.displayName === 'mia');
await simon('POST', `/reviews/${rvp.id}/comments`, { text: 'Kommentar für den Push' });
await new Promise(r => setTimeout(r, 300));
check('notify reaches ntfy without content', pushes.some(p => p.url === '/ntfy-mia-topic') && !JSON.stringify(sent).includes('Kommentar für den Push'));
check('telegram got notification', sent.some(x => x.url.includes('/sendMessage') && x.body.includes('4242')));
// Ruhezeit: zweiter Kommentar sofort danach → keine weitere Nachricht
const before2 = sent.length;
await simon('POST', `/reviews/${rvp.id}/comments`, { text: 'noch einer' });
await new Promise(r => setTimeout(r, 300));
check('quiet period', sent.length === before2);
// ungültiger Pushover-Schlüssel wird beim Zustellen entfernt
await mia('PUT', '/push/channels/pushover', { key: 'x'.repeat(30) });
await mia('POST', '/push/test');
check('invalid pushover removed', !(await mia('GET', '/push/channels')).data.channels.some(c => c.kind === 'pushover'));
pc = (await mia('DELETE', '/push/channels/telegram')).data;
check('channel delete', !pc.some(c => c.kind === 'telegram'));
await simon('PATCH', '/admin/push', { pushoverToken: '', telegramToken: '' });
check('tokens removed', (await mia('GET', '/push/channels')).data.available.telegram === null);
fake2.close();
fake.close();

// Android: Passwort-AutoFill (Digital Asset Links)
const al = await (await fetch('http://localhost:3999/.well-known/assetlinks.json')).json();
check('assetlinks', al[0]?.target.package_name === 'de.sgitaize.bookshelv' && al[0].target.sha256_cert_fingerprints[0].startsWith('62:9F:3E'), JSON.stringify(al));

console.log(`Vorschlag/Ziel/Mehrfach/Hinweise/Melden-Test: ${ok} ok, ${fail} fehlgeschlagen`);
