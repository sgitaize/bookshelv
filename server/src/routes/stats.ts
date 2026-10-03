/**
 * Lesestatistik und Jahresrückblick – alles aus user_books (gelesen + Enddatum), Büchern, Reviews und Exemplaren.
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { requireUser } from '../auth.ts';
import { router, idParam } from '../util.ts';
import { bookBrief } from './books.ts';

export const statsRoutes = router();

// zu allgemeine Schlagworte (gelten für fast jeden Roman) zählen nicht als Genre
const GENERIC = /^(belletristik|fiction|fiktionale darstellung|roman|novel|literature|.*literatur.*|general|fiction, general)$/i;

type Row = {
  bookId: number; title: string; subtitle: string | null; authors: string; year: number | null; pages: number | null; cover: string | null;
  subjects: string; language: string | null; started_at: string | null; finished_at: string; rating: number | null; formats: string | null;
};

function statsFor(userId: number, year: string | null) {
  const rows = db.prepare(`
    SELECT b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover, b.subjects, b.language,
           ub.started_at, ub.finished_at,
           (SELECT rating FROM reviews WHERE book_id = b.id AND user_id = ub.user_id) AS rating,
           (SELECT group_concat(DISTINCT format) FROM copies WHERE book_id = b.id AND owner_id = ub.user_id) AS formats
    FROM user_books ub JOIN books b ON b.id = ub.book_id
    WHERE ub.user_id = ? AND ub.status = 'read' AND ub.finished_at IS NOT NULL ${year ? 'AND ub.finished_at LIKE ?' : ''}
    ORDER BY ub.finished_at
  `).all(...(year ? [userId, `${year}%`] : [userId])) as Row[];

  const count = <T extends string>(vals: T[]) => {
    const m = new Map<T, number>();
    for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  };

  const pages = rows.reduce((a, r) => a + (r.pages ?? 0), 0);
  const rated = rows.filter(r => r.rating !== null);
  const days = rows
    .filter(r => r.started_at)
    .map(r => (Date.parse(r.finished_at) - Date.parse(r.started_at!)) / 86400_000)
    .filter(d => d >= 0 && d < 3650);

  const perMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, books: 0, pages: 0 }));
  if (year) for (const r of rows) {
    const m = Number(r.finished_at.slice(5, 7)) - 1;
    if (m >= 0 && m < 12) { perMonth[m].books++; perMonth[m].pages += r.pages ?? 0; }
  }
  // ohne Jahr: Bücher pro Jahr
  const perYear = year ? [] : count(rows.map(r => r.finished_at.slice(0, 4))).sort((a, b) => a.name.localeCompare(b.name));

  const ratings = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map(v => ({ rating: v, n: rated.filter(r => r.rating === v).length }));
  const withPages = rows.filter(r => r.pages);
  const brief = (r: Row | undefined) => (r ? bookBrief(r as unknown as Record<string, unknown>) : null);

  return {
    year,
    totals: {
      books: rows.length,
      pages,
      avgRating: rated.length ? Math.round((rated.reduce((a, r) => a + r.rating!, 0) / rated.length) * 100) / 100 : null,
      avgDays: days.length ? Math.round(days.reduce((a, d) => a + d, 0) / days.length) : null,
      rated: rated.length,
      dnf: (db.prepare(`SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND status = 'dnf' ${year ? 'AND finished_at LIKE ?' : ''}`)
        .get(...(year ? [userId, `${year}%`] : [userId])) as { n: number }).n
    },
    perMonth,
    perYear,
    ratings,
    genres: count(rows.flatMap(r => (JSON.parse(r.subjects) as string[]).filter(s => !GENERIC.test(s.trim())).slice(0, 3))).slice(0, 8),
    authors: count(rows.flatMap(r => (JSON.parse(r.authors) as string[]).slice(0, 1))).slice(0, 8),
    // Format: E-Book nur, wenn kein gedrucktes Exemplar da ist; ohne Exemplar = geliehen/sonstiges
    formats: count(rows.map(r => !r.formats ? 'none' : r.formats.includes('print') ? 'print' : 'ebook')),
    languages: count(rows.map(r => r.language ?? 'unknown')),
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
  if (!owner) throw new HTTPException(404, { message: 'Nutzer nicht gefunden' });
  if (!owner.shelf_visible && id !== u.id) throw new HTTPException(403, { message: 'Dieses Regal ist privat' });
  const y = c.req.query('year');
  if (y && !/^\d{4}$/.test(y)) throw new HTTPException(400, { message: 'Ungültige Zahl' });
  return c.json({ years: yearsOf(id), ...statsFor(id, y ?? null), user: { displayName: owner.display_name, username: owner.username } });
});
