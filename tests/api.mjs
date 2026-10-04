// API-Test Iteration 2: zwei Nutzer, Reviews, Kommentare, Sichtbarkeit
import fs from 'node:fs';
const base = 'http://localhost:3999/api';
const D = process.argv[2]; // Testordner mit data/setup-token.txt
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : (fail++, console.log('✗', name, extra)); };
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
const token = fs.readFileSync(`${D}/data/setup-token.txt`, 'utf8').trim();
check('setup', (await simon('POST', '/setup', { token, username: 'simon', displayName: 'Simon', password: 'geheim1234' })).status === 200);
const books = [];
for (const isbn of ['9783453317178', '9783257236965', '9783442476336', '9783423143592']) {
  // Katalogdienste haben gelegentlich Aussetzer → einmal wiederholen
  let r = await simon('POST', '/catalog/isbn', { isbn });
  for (let i = 0; i < 3 && !r.data?.book; i++) { await new Promise(res => setTimeout(res, 3000)); r = await simon('POST', '/catalog/isbn', { isbn }); }
  books.push(r.data.book);
  await simon('POST', '/copies', { bookId: r.data.book.id, format: 'print', binding: 'hardcover' });
}
for (const [cl, name] of [[anna, 'anna'], [ben, 'ben']]) {
  const inv = await simon('POST', '/invites', { note: name });
  check('register ' + name, (await cl('POST', '/register', { token: inv.data.token, username: name, displayName: name[0].toUpperCase() + name.slice(1), password: 'geheim1234' })).status === 200);
}
const b = books[0].id;
// halbe Sterne + Validierung
check('review 3.5', (await anna('PUT', `/books/${b}/review`, { rating: 3.5, text: 'Sandig, aber großartig. Die Bene Gesserit!', visibility: 'instance' })).data.average === 3.5);
check('invalid 3.3', (await anna('PUT', `/books/${b}/review`, { rating: 3.3 })).status === 400);
check('invalid 6', (await anna('PUT', `/books/${b}/review`, { rating: 6 })).status === 400);
await ben('PUT', `/books/${b}/review`, { rating: 5, text: 'Am Ende stirbt …', spoiler: true });
await simon('PUT', `/books/${b}/review`, { rating: 4.5, text: 'Mein Lieblingsbuch.', visibility: 'instance' });
const priv = await ben('PUT', `/books/${books[1].id}/review`, { rating: 2, text: 'geheim', visibility: 'private' });
check('private visible to self', priv.data.reviews.length === 1);
check('private hidden from others', (await simon('GET', `/books/${books[1].id}/reviews`)).data.reviews.length === 0);
let r = await simon('GET', `/books/${b}/reviews`);
check('3 reviews', r.data.reviews.length === 3, JSON.stringify(r.data).slice(0, 200));
check('avg 4.33', r.data.average === 4.33, String(r.data.average));
check('own first', r.data.reviews[0].mine === true);
// Kommentare
const annaReview = r.data.reviews.find(x => x.user.username === 'anna');
r = await simon('POST', `/reviews/${annaReview.id}/comments`, { text: 'Stimmt, die Bene Gesserit sind super.' });
const cm = r.data.reviews.find(x => x.id === annaReview.id).comments[0];
check('comment created', !!cm && cm.canDelete === true);
check('empty comment rejected', (await ben('POST', `/reviews/${annaReview.id}/comments`, { text: '  ' })).status === 400);
r = await ben('GET', `/books/${b}/reviews`);
check('ben cannot delete simons comment', r.data.reviews.find(x => x.id === annaReview.id).comments[0].canDelete === false);
check('ben delete 403', (await ben('DELETE', `/comments/${cm.id}`)).status === 403);
r = await anna('GET', `/books/${b}/reviews`);
check('review owner can delete comment', r.data.reviews.find(x => x.mine).comments[0].canDelete === true);
check('comment on private review 404', (await simon('POST', `/reviews/${priv.data.reviews[0].id}/comments`, { text: 'x' })).status === 404);
// Feed
const feed = (await simon('GET', '/reviews/recent')).data;
check('feed excludes own + private', feed.length === 2 && feed.every(x => x.user.username !== 'simon'), JSON.stringify(feed.map(x => x.user.username)));
check('feed hides spoiler text', feed.find(x => x.user.username === 'ben').text === null);
// Profil
const prof = (await simon('GET', '/users/2/profile')).data;
check('profile avg', prof.averageRating === 3.5 && prof.counts.reviews === 1, JSON.stringify(prof.counts) + prof.averageRating);
// Löschen per leerem PUT
r = await anna('PUT', `/books/${b}/review`, { rating: null, text: '' });
check('empty put deletes', r.data.reviews.length === 2);
check('comments cascade', !(await simon('GET', `/books/${b}/reviews`)).data.reviews.some(x => x.comments.length));
// Re-add for screenshots
await anna('PUT', `/books/${b}/review`, { rating: 3.5, text: 'Sandig, aber großartig. Die Bene Gesserit! Etwas lang in der Mitte, aber das Ende entschädigt für alles.' });
r = await simon('GET', `/books/${b}/reviews`);
await simon('POST', `/reviews/${r.data.reviews.find(x => x.user.username === 'anna').id}/comments`, { text: 'Stimmt, die Mitte zieht sich – Band 2 leihe ich dir!' });
await anna('PUT', `/books/${books[2].id}/review`, { rating: 4, text: 'Schottland, düster, spannend.' });
console.log(`API-Test: ${ok} ok, ${fail} fehlgeschlagen`);
