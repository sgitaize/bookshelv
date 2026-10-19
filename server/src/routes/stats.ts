/**
 * Lesestatistik und Jahresrückblick – alles aus user_books (gelesen + Enddatum), Büchern, Reviews und Exemplaren.
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { isFriend } from '../friends.ts';
import { requireUser } from '../auth.ts';
import { router, idParam, body, int } from '../util.ts';
import { bookBrief } from './books.ts';
import { parseMoods, LIGHT, DARK } from './reviews.ts';
import { langOf } from '../lang.ts';

export const statsRoutes = router();

// zu allgemeine Schlagworte (gelten für fast jeden Roman) zählen nicht als Genre
const GENERIC = /^(belletristik|fiction|fiktionale darstellung|roman|novel|literature|.*literatur.*|general|fiction, general)$/i;

type Row = {
  bookId: number; title: string; subtitle: string | null; authors: string; year: number | null; pages: number | null; cover: string | null;
  isbn13: string | null; subjects: string; language: string | null; started_at: string | null; finished_at: string; rating: number | null;
  formats: string | null; moods: string | null; pace: string | null; minutes: number | null; lang_override: string | null; reread: number;
};

const PAGE_BUCKETS = [[0, 200, '<200'], [200, 300, '200–299'], [300, 400, '300–399'], [400, 500, '400–499'], [500, Infinity, '500+']] as const;

/**
 * Zeitraum: „2026“ (Jahr), „2026-Q3“ (Quartal), „2026-09“ (Monat), „2026-01-15..2026-03-20“ (eigener Zeitraum, Ende inklusive)
 * → [von, bis) als Datumsgrenzen. Monatsverlauf (perMonth) gibt es nur für ganze Jahre.
 */
export function periodRange(period: string): { from: string; to: string; year: string } | null {
  let m = period.match(/^(\d{4})$/);
  if (m) return { from: `${m[1]}-01-01`, to: `${Number(m[1]) + 1}-01-01`, year: m[1] };
  m = period.match(/^(\d{4})-Q([1-4])$/);
  if (m) {
    const q = Number(m[2]), y = Number(m[1]);
    return { from: `${y}-${String(q * 3 - 2).padStart(2, '0')}-01`, to: q === 4 ? `${y + 1}-01-01` : `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`, year: m[1] };
  }
  m = period.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]);
    return { from: `${m[1]}-${m[2]}-01`, to: mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`, year: m[1] };
  }
  m = period.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (m) {
    const a = new Date(`${m[1]}T00:00:00Z`), b = new Date(`${m[2]}T00:00:00Z`);
    // echte Kalendertage (kein 2026-02-31), Ende nicht vor dem Anfang
    if (isNaN(+a) || isNaN(+b) || a.toISOString().slice(0, 10) !== m[1] || b.toISOString().slice(0, 10) !== m[2] || b < a) return null;
    b.setUTCDate(b.getUTCDate() + 1);
    return { from: m[1], to: b.toISOString().slice(0, 10), year: m[1].slice(0, 4) };
  }
  return null;
}

function statsFor(userId: number, period: string | null) {
  const range = period ? periodRange(period) : null;
  const year = period && /^\d{4}$/.test(period) ? period : null;
  // jede beendete Lektüre ist eine Zeile: die erste (user_books, Bewertung aus der Review) und jede weitere (rereads, eigene Bewertung)
  const rows = db.prepare(`
    WITH readings AS (
      SELECT ub.book_id, ub.started_at, ub.finished_at, rv.rating, 0 AS reread FROM user_books ub
      LEFT JOIN reviews rv ON rv.book_id = ub.book_id AND rv.user_id = ub.user_id
      WHERE ub.user_id = :u AND ub.status = 'read' AND ub.finished_at IS NOT NULL
      UNION ALL
      SELECT book_id, started_at, finished_at, rating, 1 FROM rereads WHERE user_id = :u AND finished_at IS NOT NULL
    )
    SELECT b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover, b.isbn13, b.subjects, b.language,
           r.started_at, r.finished_at, r.rating, r.reread, rv.moods, rv.pace,
           (SELECT language FROM user_book_lang WHERE user_id = :u AND book_id = b.id) AS lang_override,
           (SELECT group_concat(DISTINCT format) FROM copies WHERE book_id = b.id AND owner_id = :u) AS formats,
           (SELECT MAX(duration_min) FROM copies WHERE book_id = b.id AND owner_id = :u AND format = 'audio') AS minutes
    FROM readings r JOIN books b ON b.id = r.book_id
    LEFT JOIN reviews rv ON rv.book_id = b.id AND rv.user_id = :u
    ${range ? 'WHERE r.finished_at >= :from AND r.finished_at < :to' : ''}
    ORDER BY r.finished_at, r.reread
  `).all(range ? { u: userId, from: range.from, to: range.to } : { u: userId }) as Row[];

  /** Gruppen mit Anzahl und Buch-IDs (Antippen im Diagramm zeigt die Bücher); ein zweimal gelesenes Buch zählt zweimal, steht aber einmal in ids */
  const group = (pairs: [string, number][]) => {
    const m = new Map<string, { n: number; ids: number[] }>();
    for (const [k, id] of pairs) { const g = m.get(k) ?? { n: 0, ids: [] }; g.n++; if (!g.ids.includes(id)) g.ids.push(id); m.set(k, g); }
    return [...m.entries()].map(([name, g]) => ({ name, ...g })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
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
    period,
    totals: {
      books: rows.length,
      pages,
      minutes,
      avgPages: withPages.length ? Math.round(withPages.reduce((a, r) => a + r.pages!, 0) / withPages.length) : null,
      avgRating: rated.length ? Math.round((rated.reduce((a, r) => a + r.rating!, 0) / rated.length) * 100) / 100 : null,
      avgDays: days.length ? Math.round(days.reduce((a, d) => a + d, 0) / days.length) : null,
      rated: rated.length,
      rereads: rows.filter(r => r.reread).length,
      withMood: rows.filter(r => moodsOf(r).length).length,
      dnf: (db.prepare(`SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND status = 'dnf' ${range ? 'AND finished_at >= ? AND finished_at < ?' : ''}`)
        .get(...(range ? [userId, range.from, range.to] : [userId])) as { n: number }).n
    },
    perMonth,
    perYear,
    ratings,
    genres: group(each(r => (JSON.parse(r.subjects) as string[]).map(s => s.trim()).filter(s => s && !GENERIC.test(s)).slice(0, 3))).slice(0, 10),
    authors: group(each(r => (JSON.parse(r.authors) as string[]).slice(0, 1))).slice(0, 10),
    // Format: Druck vor E-Book vor Hörbuch (ein Buch zählt einmal); ohne Exemplar = geliehen/sonstiges
    formats: group(rows.map(r => [!r.formats ? 'none' : r.formats.includes('print') ? 'print' : r.formats.includes('ebook') ? 'ebook' : 'audio', r.bookId])),
    languages: group(rows.map(r => [r.lang_override ?? langOf(r.language, r.isbn13), r.bookId])),
    pageBuckets,
    moods: group(each(moodsOf)),
    paces: group(rows.filter(r => r.pace).map(r => [r.pace!, r.bookId])),
    books: Object.fromEntries(rows.map(r => [r.bookId, brief(r)])),
    highlights: {
      first: brief(rows[0]),
      last: brief(rows.at(-1)),
      longest: brief([...withPages].sort((a, b) => b.pages! - a.pages!)[0]),
      shortest: brief([...withPages].sort((a, b) => a.pages! - b.pages!)[0]),
      fiveStars: rows.filter((r, i) => r.rating === 5 && rows.findIndex(x => x.bookId === r.bookId && x.rating === 5) === i).slice(0, 6).map(r => brief(r)!),
      // bestes Buch des Zeitraums: höchste Bewertung, bei Gleichstand das zuletzt gelesene
      top: brief([...rows].filter(r => r.rating !== null).sort((a, b) => b.rating! - a.rating! || b.finished_at.localeCompare(a.finished_at))[0]),
      topRating: [...rows].filter(r => r.rating !== null).sort((a, b) => b.rating! - a.rating!)[0]?.rating ?? null
    },
    // Reihenfolge des Fertiglesens (Cover-Wand im Teilen-Bild)
    order: rows.map(r => r.bookId)
  };
}

// ---------- Leseziel ----------

type GoalRow = { books: number | null; pages: number | null };
const goalRow = (userId: number, year: number) => db.prepare('SELECT books, pages FROM reading_goals WHERE user_id = ? AND year = ?').get(userId, year) as GoalRow | undefined;

/**
 * Ziel eines Jahres mit Stand: Bücher = beendete Lektüren (auch erneut gelesene), Seiten wie in der Statistik
 * (nur gehörte Bücher zählen nicht als Seiten). expected = Soll-Stand heute bei gleichmäßigem Lesen (nur laufendes Jahr).
 */
export function goalOf(userId: number, year: number) {
  const g = goalRow(userId, year);
  if (!g) return null;
  const done = db.prepare(`
    WITH readings AS (
      SELECT book_id FROM user_books WHERE user_id = :u AND status = 'read' AND finished_at >= :from AND finished_at < :to
      UNION ALL SELECT book_id FROM rereads WHERE user_id = :u AND finished_at >= :from AND finished_at < :to
    )
    SELECT COUNT(*) AS books, COALESCE(SUM(CASE WHEN (SELECT group_concat(DISTINCT format) FROM copies WHERE book_id = r.book_id AND owner_id = :u) = 'audio'
      THEN 0 ELSE b.pages END), 0) AS pages
    FROM readings r JOIN books b ON b.id = r.book_id
  `).get({ u: userId, from: `${year}-01-01`, to: `${year + 1}-01-01` }) as { books: number; pages: number };
  const now = new Date();
  const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
  const share = now.getUTCFullYear() === year ? (now.getTime() - start) / (end - start) : null;
  return {
    year, books: g.books, pages: g.pages, done,
    expected: share === null ? null : { books: g.books ? Math.round(g.books * share * 10) / 10 : null, pages: g.pages ? Math.round(g.pages * share) : null }
  };
}

statsRoutes.get('/goals/:year', c => {
  const u = requireUser(c);
  const year = int(c.req.param('year'), 1900, 2999)!;
  return c.json(goalOf(u.id, year));
});

/** Ziel setzen; books und pages null/leer = ohne dieses Ziel, beide leer = Ziel löschen */
statsRoutes.put('/goals/:year', async c => {
  const u = requireUser(c);
  const year = int(c.req.param('year'), 1900, 2999)!;
  const b = await body(c);
  const books = int(b.books, 1, 10000), pages = int(b.pages, 1, 10_000_000);
  if (!books && !pages) db.prepare('DELETE FROM reading_goals WHERE user_id = ? AND year = ?').run(u.id, year);
  else db.prepare(`INSERT INTO reading_goals (user_id, year, books, pages) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, year) DO UPDATE SET books = excluded.books, pages = excluded.pages, updated_at = datetime('now')`).run(u.id, year, books, pages);
  return c.json(goalOf(u.id, year));
});

/** Sprachen der ganzen Bibliothek (alle Bücher im Regal, nicht nur gelesene) mit Anzahl gelesen */
function libraryLanguages(userId: number) {
  const rows = db.prepare(`
    SELECT DISTINCT b.id AS bookId, b.language, b.isbn13, COALESCE(ub.status, 'unread') AS status,
           (SELECT language FROM user_book_lang WHERE user_id = c.owner_id AND book_id = b.id) AS lang_override
    FROM copies c JOIN books b ON b.id = c.book_id
    LEFT JOIN user_books ub ON ub.user_id = c.owner_id AND ub.book_id = b.id
    WHERE c.owner_id = ? AND c.removed_at IS NULL
  `).all(userId) as { bookId: number; language: string | null; isbn13: string | null; status: string; lang_override: string | null }[];
  const m = new Map<string, { name: string; n: number; read: number; ids: number[] }>();
  for (const r of rows) {
    const name = r.lang_override ?? langOf(r.language, r.isbn13);
    const g = m.get(name) ?? { name, n: 0, read: 0, ids: [] };
    g.n++; if (r.status === 'read') g.read++; g.ids.push(r.bookId);
    m.set(name, g);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

/** Monate mit gelesenen Büchern (Auswahl im Teilen-Bild) */
const FINISHED = `SELECT finished_at FROM user_books WHERE user_id = :u AND status = 'read' AND finished_at IS NOT NULL
  UNION ALL SELECT finished_at FROM rereads WHERE user_id = :u AND finished_at IS NOT NULL`;

const monthsOf = (userId: number) => (db.prepare(`SELECT DISTINCT substr(finished_at, 1, 7) AS m FROM (${FINISHED}) ORDER BY m DESC`)
  .all({ u: userId }) as { m: string }[]).map(r => r.m);

const yearsOf = (userId: number) => (db.prepare(`SELECT DISTINCT substr(finished_at, 1, 4) AS y FROM (${FINISHED}) ORDER BY y DESC`)
  .all({ u: userId }) as { y: string }[]).map(r => r.y);

statsRoutes.get('/stats', c => {
  const u = requireUser(c);
  // ?period=2026|2026-Q3|2026-09|2026-01-15..2026-03-20, ?year=2026 wie bisher
  const y = c.req.query('period') ?? c.req.query('year');
  if (y && !periodRange(y)) throw new HTTPException(400, { message: 'Ungültiger Zeitraum' });
  return c.json({ years: yearsOf(u.id), months: monthsOf(u.id), ...statsFor(u.id, y ?? null), library: { languages: libraryLanguages(u.id) },
    goal: y && /^\d{4}$/.test(y) ? goalOf(u.id, Number(y)) : null, user: { displayName: u.display_name, username: u.username } });
});

/** Statistik von Freund*innen (für den Vergleich/Jahresrückblick), nur bei sichtbarem Regal */
statsRoutes.get('/users/:id/stats', c => {
  const u = requireUser(c);
  const id = idParam(c);
  const owner = db.prepare('SELECT display_name, username, shelf_visible FROM users WHERE id = ? AND disabled = 0').get(id) as
    { display_name: string; username: string; shelf_visible: number } | undefined;
  if (!owner) throw new HTTPException(404, { message: 'Konto nicht gefunden' });
  if ((!owner.shelf_visible || !isFriend(u.id, id)) && id !== u.id) throw new HTTPException(403, { message: 'Dieses Regal ist privat' });
  // ?period=2026|2026-Q3|2026-09|2026-01-15..2026-03-20, ?year=2026 wie bisher
  const y = c.req.query('period') ?? c.req.query('year');
  if (y && !periodRange(y)) throw new HTTPException(400, { message: 'Ungültiger Zeitraum' });
  return c.json({ years: yearsOf(id), ...statsFor(id, y ?? null), user: { displayName: owner.display_name, username: owner.username } });
});
