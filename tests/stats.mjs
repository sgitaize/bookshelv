// Iteration 7: Statistik (läuft nach extras.mjs – dort wurde u. a. „Der Schatten des Windes“ als 2024 gelesen, 5 Sterne importiert)
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
let s = (await req('GET', '/stats?year=2024')).data;
check('years list', s.years.includes('2024'));
check('2024 totals', s.totals.books >= 1 && s.totals.pages >= 0 && s.totals.avgRating === 5, JSON.stringify(s.totals));
check('per month march', s.perMonth[2].books >= 1 && s.perMonth.length === 12);
check('ratings dist', s.ratings.find(r => r.rating === 5).n >= 1 && s.ratings.length === 10);
check('highlights', s.highlights.first && s.highlights.fiveStars.length >= 1);
check('formats', s.formats.every(f => ['print', 'ebook', 'none'].includes(f.name)));
check('generic genres filtered', s.genres.every(g => !/^(belletristik|fiction)$/i.test(g.name)), JSON.stringify(s.genres));
s = (await req('GET', '/stats')).data;
check('all years perYear', s.year === null && s.perYear.length >= 1);
check('bad year 400', (await req('GET', '/stats?year=20x4')).status === 400);
console.log(`Statistik-Test: ${ok} ok, ${fail} fehlgeschlagen`);
