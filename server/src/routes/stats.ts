/**
 * Lesestatistik und Jahresrückblick – alles aus user_books (gelesen + Enddatum), Büchern, Reviews und Exemplaren.
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { requireUser } from '../auth.ts';
import { router, idParam } from '../util.ts';
import { bookBrief } from './books.ts';
import { parseMoods, LIGHT, DARK } from './reviews.ts';

export const statsRoutes = router();

// zu allgemeine Schlagworte (gelten für fast jeden Roman) zählen nicht als Genre
const GENERIC = /^(belletristik|fiction|fiktionale darstellung|roman|novel|literature|.*literatur.*|general|fiction, general)$/i;

type Row = {
  bookId: number; title: string; subtitle: string | null; authors: string; year: number | null; pages: number | null; cover: string | null;
  isbn13: string | null; subjects: string; language: string | null; started_at: string | null; finished_at: string; rating: number | null;
  formats: string | null; moods: string | null; pace: string | null; minutes: number | null;
};

/** DNB liefert ISO 639-2/B („ger“), Open Library oft nichts – dann Sprachraum aus der ISBN-Gruppe schätzen */
const LANG: Record<string, string> = {
  ger: 'de', deu: 'de', de: 'de', eng: 'en', en: 'en', fre: 'fr', fra: 'fr', fr: 'fr', spa: 'es', es: 'es', ita: 'it', it: 'it',
  dut: 'nl', nld: 'nl', nl: 'nl', swe: 'sv', sv: 'sv', dan: 'da', da: 'da', nor: 'no', no: 'no', pol: 'pl', pl: 'pl',
  por: 'pt', pt: 'pt', tur: 'tr', tr: 'tr', rus: 'ru', ru: 'ru', jpn: 'ja', ja: 'ja', lat: 'la', la: 'la'
};
function languageOf(r: Row): string {
  const code = r.language?.trim().toLowerCase();
  if (code && LANG[code]) return LANG[code];
  if (code) return code;
  const g = r.isbn13?.startsWith('978') ? r.isbn13.slice(3) : null;
  if (!g) return 'unknown';
  if (g[0] === '3') return 'de';
  if (g[0] === '0' || g[0] === '1') return 'en';
  if (g[0] === '2') return 'fr';
  if (g.startsWith('88')) return 'it';
  if (g.startsWith('84')) return 'es';
  if (g.startsWith('90') || g.startsWith('94')) return 'nl';
  return 'unknown';
}

const PAGE_BUCKETS = [[0, 200, '<200'], [200, 300, '200–299'], [300, 400, '300–399'], [400, 500, '400–499'], [500, Infinity, '500+']] as const;

function statsFor(userId: number, year: string | null) {
  const rows = db.prepare(`
    SELECT b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover, b.isbn13, b.subjects, b.language,
           ub.started_at, ub.finished_at, rv.rating, rv.moods, rv.pace,
           (SELECT group_concat(DISTINCT format) FROM copies WHERE book_id = b.id AND owner_id = ub.user_id) AS formats,
           (SELECT MAX(duration_min) FROM copies WHERE book_id = b.id AND owner_id = ub.user_id AND format = 'audio') AS minutes
    FROM user_books ub JOIN books b ON b.id = ub.book_id
    LEFT JOIN reviews rv ON rv.book_id = b.id AND rv.user_id = ub.user_id
    WHERE ub.user_id = ? AND ub.status = 'read' AND ub.finished_at IS NOT NULL ${year ? 'AND ub.finished_at LIKE ?' : ''}
    ORDER BY ub.finished_at
  `).all(...(year ? [userId, `${year}%`] : [userId])) as Row[];

  /** Gruppen mit Anzahl und Buch-IDs (Antippen im Diagramm zeigt die Bücher) */
  const group = (pairs: [string, number][]) => {
    const m = new Map<string, number[]>();
    for (const [k, id] of pairs) { const l = m.get(k) ?? []; if (!l.includes(id)) l.push(id); m.set(k, l); }
    return [...m.entries()].map(([name, ids]) => ({ name, n: ids.length, ids })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  };
  const each = <T,>(f: (r: Row) => T[]): [T, number][] => rows.flatMap(r => f(r).map(v => [v, r.bookId] as [T, number]));

  // nur gehört (kein Druck/E-Book) → zählt als Minuten, nicht als Seiten (wie StoryGraph)
  const audioOnly = (r: Row) => r.formats === 'audio';
  const pagesOf = (r: Row) => (audioOnly(r) ? 0 : r.pages ?? 0);
  const pages = rows.reduce((a, r) => a + pagesOf(r), 0);
  const minutes = rows.reduce((a, r) => a + (audioOnly(r) ? r.minutes ?? 0 : 0), 0);
  const rated = rows.filter(r => r.rating !== null);
  const days = rows
    .filter(r => r.started_at)
    .map(r => (Date.parse(r.finished_at) - Date.parse(r.started_at!)) / 86400_000)
    .filter(d => d >= 0 && d < 3650);
  const moodsOf = (r: Row) => parseMoods(r.moods ?? undefined);

  const perMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, books: 0, pages: 0, minutes: 0, ids: [] as number[], mood: null as number | null }));
  if (year) {
    const score = Array.from({ length: 12 }, () => [] as number[]);
    for (const r of rows) {
      const m = Number(r.finished_at.slice(5, 7)) - 1;
      if (m < 0 || m > 11) continue;
      perMonth[m].books++; perMonth[m].pages += pagesOf(r); perMonth[m].minutes += audioOnly(r) ? r.minutes ?? 0 : 0; perMonth[m].ids.push(r.bookId);
      const md = moodsOf(r);
      if (md.length) score[m].push(md.reduce((a, x) => a + (LIGHT.includes(x) ? 1 : DARK.includes(x) ? -1 : 0), 0) / md.length);
    }
    // Stimmungskurve: Monatsmittel, leere Monate übernehmen den Vormonat (wie bei StoryGraph eine durchgehende Linie)
    let last: number | null = null;
    for (let m = 0; m < 12; m++) {
      if (score[m].length) last = Math.round((score[m].reduce((a, x) => a + x, 0) / score[m].length) * 100) / 100;
      perMonth[m].mood = last;
    }
  }
  const perYear = year ? [] : group(rows.map(r => [r.finished_at.slice(0, 4), r.bookId])).sort((a, b) => a.name.localeCompare(b.name));

  const ratings = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map(v => {
    const ids = rated.filter(r => r.rating === v).map(r => r.bookId);
    return { rating: v, n: ids.length, ids };
  });
  const withPages = rows.filter(r => r.pages);
  const brief = (r: Row | undefined) => (r ? bookBrief(r as unknown as Record<string, unknown>) : null);
  const pageBuckets: { name: string; n: number; ids: number[] }[] = PAGE_BUCKETS.map(([lo, hi, name]) => {
    const ids = withPages.filter(r => r.pages! >= lo && r.pages! < hi).map(r => r.bookId);
    return { name, n: ids.length, ids };
  });
  const noPages = rows.filter(r => !r.pages).map(r => r.bookId);
  if (noPages.length) pageBuckets.push({ name: 'unknown', n: noPages.length, ids: noPages });

  return {
    year,
    totals: {
      books: rows.length,
      pages,
      minutes,
      avgPages: withPages.length ? Math.round(withPages.reduce((a, r) => a + r.pages!, 0) / withPages.length) : null,
      avgRating: rated.length ? Math.round((rated.reduce((a, r) => a + r.rating!, 0) / rated.length) * 100) / 100 : null,
      avgDays: days.length ? Math.round(days.reduce((a, d) => a + d, 0) / days.length) : null,
      rated: rated.length,
      withMood: rows.filter(r => moodsOf(r).length).length,
      dnf: (db.prepare(`SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND status = 'dnf' ${year ? 'AND finished_at LIKE ?' : ''}`)
        .get(...(year ? [userId, `${year}%`] : [userId])) as { n: number }).n
    },
    perMonth,
    perYear,
    ratings,
    genres: group(each(r => (JSON.parse(r.subjects) as string[]).map(s => s.trim()).filter(s => s && !GENERIC.test(s)).slice(0, 3))).slice(0, 10),
    authors: group(each(r => (JSON.parse(r.authors) as string[]).slice(0, 1))).slice(0, 10),
    // Format: Druck vor E-Book vor Hörbuch (ein Buch zählt einmal); ohne Exemplar = geliehen/sonstiges
    formats: group(rows.map(r => [!r.formats ? 'none' : r.formats.includes('print') ? 'print' : r.formats.includes('ebook') ? 'ebook' : 'audio', r.bookId])),
    languages: group(rows.map(r => [languageOf(r), r.bookId])),
    pageBuckets,
    moods: group(each(moodsOf)),
    paces: group(rows.filter(r => r.pace).map(r => [r.pace!, r.bookId])),
    books: Object.fromEntries(rows.map(r => [r.bookId, brief(r)])),
    highlights: {
      first: brief(rows[0]),
      last: brief(rows.at(-1)),
      longest: brief([...withPages].sort((a, b) => b.pages! - a.pages!)[0]),
      shortest: brief([...withPages].sort((a, b) => a.pages! - b.pages!)[0]),
      fiveStars: rows.filter(r => r.rating === 5).slice(0, 6).map(r => brief(r)!)
    }
  };
}

const yearsOf = (userId: number) => (db.prepare(`
  SELECT DISTINCT substr(finished_at, 1, 4) AS y FROM user_books WHERE user_id = ? AND status = 'read' AND finished_at IS NOT NULL ORDER BY y DESC
`).all(userId) as { y: string }[]).map(r => r.y);

statsRoutes.get('/stats', c => {
  const u = requireUser(c);
  const y = c.req.query('year');
  if (y && !/^\d{4}$/.test(y)) throw new HTTPException(400, { message: 'Ungültige Zahl' });
  return c.json({ years: yearsOf(u.id), ...statsFor(u.id, y ?? null), user: { displayName: u.display_name, username: u.username } });
});

/** Statistik von Freunden (für den Vergleich/Jahresrückblick), nur bei sichtbarem Regal */
statsRoutes.get('/users/:id/stats', c => {
  const u = requireUser(c);
  const id = idParam(c);
  const owner = db.prepare('SELECT display_name, username, shelf_visible FROM users WHERE id = ? AND disabled = 0').get(id) as
    { display_name: string; username: string; shelf_visible: number } | undefined;
  if (!owner) throw new HTTPException(404, { message: 'Konto nicht gefunden' });
  if (!owner.shelf_visible && id !== u.id) throw new HTTPException(403, { message: 'Dieses Regal ist privat' });
  const y = c.req.query('year');
  if (y && !/^\d{4}$/.test(y)) throw new HTTPException(400, { message: 'Ungültige Zahl' });
  return c.json({ years: yearsOf(id), ...statsFor(id, y ?? null), user: { displayName: owner.display_name, username: owner.username } });
});
