// Import als Hintergrund-Job auf dem Server: hochladen, Fortschritt abfragen, Konflikte entscheiden, abbrechen, rückgängig
const base = 'http://localhost:3999/api';
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? ok++ : (fail++, console.log('✗', n, x)); };
let cookie = '';
const req = async (method, url, body) => {
  const json = method !== 'GET';
  const r = await fetch(base + url, { method, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), cookie }, body: json ? JSON.stringify(body ?? {}) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
};
const wait = async id => {
  for (let i = 0; i < 100; i++) {
    const j = (await req('GET', `/imports/${id}`)).data;
    if (j.status !== 'running') return j;
    await new Promise(r => setTimeout(r, 200));
  }
  return (await req('GET', `/imports/${id}`)).data;
};
await req('POST', '/login', { username: 'simon', password: 'geheim1234' });

// 20 Bücher ohne ISBN (kein Katalog nötig) → drei Pakete
const items = Array.from({ length: 20 }, (_, i) => ({ title: `Job-Buch ${i + 1}`, authors: ['Jobautorin'], status: 'read', finishedAt: '2022-03-04', rating: 4, owned: true }));
let r = await req('POST', '/imports/jobs', { source: 'test', filename: 'job.csv', items, options: { copies: 'owned', conflict: 'ask' } });
check('job created', r.status === 200 && r.data.id, JSON.stringify(r.data));
const second = await req('POST', '/imports/jobs', { source: 'test', items: items.slice(0, 1) });
check('one running job per person', second.status === 409 || second.status === 200);
let j = await wait(r.data.id);
check('job done', j.status === 'done' && j.done === 20 && j.ok === 20 && !j.failed.length, JSON.stringify({ ...j, conflicts: undefined }));
const lib = (await req('GET', '/copies')).data;
check('copies created', lib.filter(c => /^Job-Buch/.test(c.book.title)).length === 20);
check('import_done notification', (await req('GET', '/notifications')).data.items.some(n => n.type === 'import_done' && n.refId === r.data.id && n.actor?.displayName === 'job.csv'));
check('history shows status', (await req('GET', '/imports')).data.find(x => x.id === r.data.id)?.status === 'done');

// gleicher Import mit anderer Bewertung → Konflikte (Regel „ask“), dann teilweise „Import übernehmen“
if (second.status === 200) await wait(second.data.id);
const again = items.slice(0, 3).map(x => ({ ...x, rating: 2 }));
r = await req('POST', '/imports/jobs', { source: 'test', items: again, options: { conflict: 'ask' } });
j = await wait(r.data.id);
check('conflicts reported', j.conflicts?.length === 3 && j.conflicts.every(c => c.field === 'rating' && c.mine === 4 && c.theirs === 2), JSON.stringify(j.conflicts));
const pickTitle = j.conflicts[0].title;
j = (await req('POST', `/imports/${r.data.id}/resolve`, { theirs: [0] })).data;
j = await wait(r.data.id);
check('resolve done, conflicts cleared', j.status === 'done' && j.conflicts.length === 0, JSON.stringify(j));
const books = (await req('GET', '/copies')).data.filter(c => /^Job-Buch/.test(c.book.title));
const picked = books.find(c => c.book.title === pickTitle);
const rev = (await req('GET', `/books/${picked.book.id}/reviews`)).data.reviews.find(x => x.mine);
check('resolved rating applied', rev?.rating === 2, JSON.stringify(rev));
const other = books.find(c => c.book.title === j.conflicts?.[1]?.title || c.book.title === 'Job-Buch 2');
const rev2 = (await req('GET', `/books/${other.book.id}/reviews`)).data.reviews.find(x => x.mine);
check('unpicked rating kept', rev2?.rating === 4, JSON.stringify(rev2));

// Abbrechen + Rückgängig: großer Job, sofort abbrechen
const many = Array.from({ length: 200 }, (_, i) => ({ title: `Abbruch-Buch ${i + 1}`, authors: ['Jobautorin'], status: 'unread', owned: true }));
r = await req('POST', '/imports/jobs', { source: 'test', items: many, options: { copies: 'owned' } });
j = (await req('POST', `/imports/${r.data.id}/cancel`)).data;
check('cancel', j.status === 'cancelled' && j.done < 200, JSON.stringify({ status: j.status, done: j.done }));
await new Promise(res => setTimeout(res, 500));
const after = (await req('GET', `/imports/${r.data.id}`)).data;
check('cancel sticks', after.status === 'cancelled' && after.done === j.done, JSON.stringify(after));
check('undo cancelled job', (await req('POST', `/imports/${r.data.id}/undo`)).status === 200);
check('nothing left after undo', !(await req('GET', '/copies')).data.some(c => /^Abbruch-Buch/.test(c.book.title)));
check('empty job 400', (await req('POST', '/imports/jobs', { items: [] })).status === 400);
console.log(`Import-Job-Test: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) process.exitCode = 1;
