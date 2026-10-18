/**
 * Mehrfach gelesen: die erste Lektüre bleibt der Lesestand in user_books (mit Review-Bewertung),
 * jede weitere steht hier mit eigenem Zeitraum und optionaler Bewertung. Ohne Enddatum = liest gerade erneut.
 * Statistik, Jahresrückblick und „gelesen <Jahr>“ zählen jede beendete Lektüre einzeln.
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { requireUser } from '../auth.ts';
import { router, body, idParam, notFound } from '../util.ts';
import { getBook } from './books.ts';
import { rating } from './reviews.ts';
import { today } from './reading.ts';

export const rereadRoutes = router();

type RereadRow = { id: number; user_id: number; book_id: number; started_at: string | null; finished_at: string | null; rating: number | null; created_at: string };

const MAX = 100;
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const rereadJson = (r: RereadRow) => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, rating: r.rating });

export const rereadsOf = (userId: number, bookId: number) =>
  (db.prepare(`SELECT * FROM rereads WHERE user_id = ? AND book_id = ? ORDER BY COALESCE(finished_at, '9999'), COALESCE(started_at, ''), id`)
    .all(userId, bookId) as RereadRow[]).map(rereadJson);

/** beendete Lektüren (erste + weitere) einer Person, deren Ende mit `prefix` beginnt (z. B. Jahr) */
export const readCount = (userId: number, prefix = '') => (db.prepare(`
  SELECT (SELECT COUNT(*) FROM user_books WHERE user_id = :u AND status = 'read' ${prefix ? 'AND finished_at LIKE :p' : ''})
       + (SELECT COUNT(*) FROM rereads WHERE user_id = :u AND finished_at IS NOT NULL ${prefix ? 'AND finished_at LIKE :p' : ''}) AS n
`).get(prefix ? { u: userId, p: `${prefix}%` } : { u: userId }) as { n: number }).n;

function values(b: Record<string, unknown>, cur?: RereadRow) {
  const date = (v: unknown, fallback: string | null) => {
    if (v === undefined) return fallback;
    if (v === null || v === '') return null;
    if (!isDate(v)) throw new HTTPException(400, { message: 'Datum im Format JJJJ-MM-TT' });
    return v as string;
  };
  const startedAt = date(b.startedAt, cur?.started_at ?? null), finishedAt = date(b.finishedAt, cur?.finished_at ?? null);
  if (startedAt && finishedAt && finishedAt < startedAt) throw new HTTPException(400, { message: 'Das Ende liegt vor dem Beginn' });
  if ((startedAt && startedAt > today()) || (finishedAt && finishedAt > today())) throw new HTTPException(400, { message: 'Datum liegt in der Zukunft' });
  return { startedAt, finishedAt, rating: b.rating === undefined ? cur?.rating ?? null : rating(b.rating) };
}

const own = (userId: number, id: number) => {
  const r = db.prepare('SELECT * FROM rereads WHERE id = ? AND user_id = ?').get(id, userId) as RereadRow | undefined;
  if (!r) throw notFound('Lektüre');
  return r;
};

rereadRoutes.get('/books/:id/rereads', c => c.json(rereadsOf(requireUser(c).id, idParam(c))));

/** Weitere Lektüre anlegen; ohne Angaben = „lese ich gerade wieder“ ab heute */
rereadRoutes.post('/books/:id/rereads', async c => {
  const u = requireUser(c);
  const id = idParam(c);
  if (!getBook(id)) throw notFound('Buch');
  const b = await body(c);
  if ((db.prepare('SELECT COUNT(*) AS n FROM rereads WHERE user_id = ? AND book_id = ?').get(u.id, id) as { n: number }).n >= MAX)
    throw new HTTPException(409, { message: 'Höchstens 100 Lektüren je Buch' });
  const v = values({ startedAt: today(), ...b });
  db.prepare('INSERT INTO rereads (user_id, book_id, started_at, finished_at, rating) VALUES (?, ?, ?, ?, ?)').run(u.id, id, v.startedAt, v.finishedAt, v.rating);
  // erste Lektüre gilt damit als gelesen (wer etwas „noch mal“ liest, hat es schon einmal gelesen)
  db.prepare(`INSERT INTO user_books (user_id, book_id, status) VALUES (?, ?, 'read')
    ON CONFLICT (user_id, book_id) DO UPDATE SET status = 'read', updated_at = datetime('now') WHERE status IN ('unread', 'reading')`).run(u.id, id);
  return c.json(rereadsOf(u.id, id));
});

rereadRoutes.patch('/rereads/:id', async c => {
  const u = requireUser(c);
  const r = own(u.id, idParam(c));
  const v = values(await body(c), r);
  db.prepare('UPDATE rereads SET started_at = ?, finished_at = ?, rating = ? WHERE id = ?').run(v.startedAt, v.finishedAt, v.rating, r.id);
  return c.json(rereadsOf(u.id, r.book_id));
});

rereadRoutes.delete('/rereads/:id', c => {
  const u = requireUser(c);
  const r = own(u.id, idParam(c));
  db.prepare('DELETE FROM rereads WHERE id = ?').run(r.id);
  return c.json(rereadsOf(u.id, r.book_id));
});
