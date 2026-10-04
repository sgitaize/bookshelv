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
// Zeiträume für das Teilen-Bild: Monat/Quartal/Jahr müssen zusammenpassen
const st0 = (await simon('GET', '/stats')).data;
check('months listed', Array.isArray(st0.months) && st0.months.length > 0, JSON.stringify(st0.months));
const y = st0.years.find(x => (st0.months ?? []).some(m => m.startsWith(x)));
const year = (await simon('GET', `/stats?period=${y}`)).data;
check('period=year equals year=', year.totals.books === (await simon('GET', `/stats?year=${y}`)).data.totals.books && year.period === y);
let q = 0, m = 0;
for (let i = 1; i <= 4; i++) q += (await simon('GET', `/stats?period=${y}-Q${i}`)).data.totals.books;
for (let i = 1; i <= 12; i++) m += (await simon('GET', `/stats?period=${y}-${String(i).padStart(2, '0')}`)).data.totals.books;
check('quarters sum to year', q === year.totals.books, `${q} vs ${year.totals.books}`);
check('months sum to year', m === year.totals.books, `${m} vs ${year.totals.books}`);
const mo = (await simon('GET', `/stats?period=${st0.months[0]}`)).data;
check('month has order + highlights', Array.isArray(mo.order) && mo.order.length === mo.totals.books && 'top' in mo.highlights);
check('bad period 400', (await simon('GET', '/stats?period=2026-Q5')).status === 400 && (await simon('GET', '/stats?period=2026-13')).status === 400);
console.log(`Zeitraum-Test: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
