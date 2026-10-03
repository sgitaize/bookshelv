/**
 * Persönliche Historie: alle Ereignisse rund um die eigenen Bücher als Zeitachse.
 * Wird aus den vorhandenen Tabellen zusammengesetzt (keine eigene Event-Tabelle nötig).
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { requireUser } from '../auth.ts';
import { router, int } from '../util.ts';
import { bookBrief } from './books.ts';

export const historyRoutes = router();

export const EVENT_TYPES = ['added', 'removed', 'started', 'finished', 'dnf', 'reviewed', 'lent', 'got_back', 'borrowed', 'gave_back'] as const;
type EventType = (typeof EVENT_TYPES)[number];

// date = YYYY-MM-DD; person = Gegenüber beim Verleih; value = Sterne bei Bewertungen
const EVENTS_SQL = `
  SELECT 'added' AS type, substr(c.created_at, 1, 10) AS date, c.book_id, NULL AS person, NULL AS value, c.format AS extra FROM copies c WHERE c.owner_id = :u
  UNION ALL SELECT 'removed', substr(c.removed_at, 1, 10), c.book_id, NULL, NULL, c.removed_reason FROM copies c WHERE c.owner_id = :u AND c.removed_at IS NOT NULL
  UNION ALL SELECT 'started', ub.started_at, ub.book_id, NULL, NULL, NULL FROM user_books ub WHERE ub.user_id = :u AND ub.started_at IS NOT NULL
  UNION ALL SELECT CASE ub.status WHEN 'dnf' THEN 'dnf' ELSE 'finished' END, ub.finished_at, ub.book_id, NULL, NULL, NULL
    FROM user_books ub WHERE ub.user_id = :u AND ub.finished_at IS NOT NULL AND ub.status IN ('read', 'dnf')
  UNION ALL SELECT 'reviewed', substr(r.created_at, 1, 10), r.book_id, NULL, r.rating, NULL FROM reviews r WHERE r.user_id = :u
  UNION ALL SELECT 'lent', l.lent_at, c.book_id, COALESCE(bo.display_name, ra.display_name, l.borrower_name), NULL, l.due_at
    FROM loans l JOIN copies c ON c.id = l.copy_id LEFT JOIN users bo ON bo.id = l.borrower_id
    LEFT JOIN remote_actors ra ON ra.id = l.borrower_remote_id WHERE l.lender_id = :u
  UNION ALL SELECT 'got_back', l.returned_at, c.book_id, COALESCE(bo.display_name, ra.display_name, l.borrower_name), NULL, NULL
    FROM loans l JOIN copies c ON c.id = l.copy_id LEFT JOIN users bo ON bo.id = l.borrower_id
    LEFT JOIN remote_actors ra ON ra.id = l.borrower_remote_id WHERE l.lender_id = :u AND l.returned_at IS NOT NULL
  UNION ALL SELECT 'borrowed', rl.lent_at, b.id, ra.display_name, NULL, rl.due_at
    FROM remote_loans rl JOIN remote_actors ra ON ra.id = rl.lender_actor_id JOIN books b ON b.isbn13 = rl.isbn13 WHERE rl.borrower_id = :u
  UNION ALL SELECT 'gave_back', rl.returned_at, b.id, ra.display_name, NULL, NULL
    FROM remote_loans rl JOIN remote_actors ra ON ra.id = rl.lender_actor_id JOIN books b ON b.isbn13 = rl.isbn13 WHERE rl.borrower_id = :u AND rl.returned_at IS NOT NULL
  UNION ALL SELECT 'borrowed', l.lent_at, c.book_id, le.display_name, NULL, l.due_at
    FROM loans l JOIN copies c ON c.id = l.copy_id JOIN users le ON le.id = l.lender_id WHERE l.borrower_id = :u
  UNION ALL SELECT 'gave_back', l.returned_at, c.book_id, le.display_name, NULL, NULL
    FROM loans l JOIN copies c ON c.id = l.copy_id JOIN users le ON le.id = l.lender_id WHERE l.borrower_id = :u AND l.returned_at IS NOT NULL
`;

// Reihenfolge innerhalb eines Tages: was logisch später passiert, steht oben
const ORDER: Record<EventType, number> = { gave_back: 9, got_back: 9, removed: 8, reviewed: 7, finished: 6, dnf: 6, lent: 5, borrowed: 5, started: 4, added: 1 };

const isDate = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

historyRoutes.get('/history', c => {
  const u = requireUser(c);
  const q = c.req.query();
  if ((q.from && !isDate(q.from)) || (q.to && !isDate(q.to))) throw new HTTPException(400, { message: 'Datum im Format JJJJ-MM-TT' });
  const types = (q.types ?? '').split(',').filter((t): t is EventType => (EVENT_TYPES as readonly string[]).includes(t));
  const bookId = int(q.book, 1, Number.MAX_SAFE_INTEGER);
  const search = (q.q ?? '').trim().toLowerCase().slice(0, 100);

  const where = ['e.date IS NOT NULL'];
  const params: Record<string, string | number> = { u: u.id };
  if (q.from) { where.push('e.date >= :from'); params.from = q.from; }
  if (q.to) { where.push('e.date <= :to'); params.to = q.to; }
  if (bookId) { where.push('e.book_id = :book'); params.book = bookId; }
  if (types.length) where.push(`e.type IN (${types.map(t => `'${t}'`).join(',')})`);
  if (search) {
    where.push(`(lower(b.title) LIKE :q OR lower(b.authors) LIKE :q OR lower(COALESCE(e.person, '')) LIKE :q)`);
    params.q = `%${search}%`;
  }
  const rows = db.prepare(`
    SELECT e.*, b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover
    FROM (${EVENTS_SQL}) e JOIN books b ON b.id = e.book_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.date DESC LIMIT 1000
  `).all(params) as Array<Record<string, unknown>>;

  const events = rows
    .map(r => ({
      type: r.type as EventType, date: r.date as string, person: r.person as string | null,
      rating: r.type === 'reviewed' ? (r.value as number | null) : null,
      dueAt: r.type === 'lent' || r.type === 'borrowed' ? (r.extra as string | null) : null,
      reason: r.type === 'removed' ? (r.extra as string | null) : null,
      book: bookBrief(r)
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || ORDER[b.type] - ORDER[a.type]);

  // Jahre, in denen es überhaupt Ereignisse gibt (für die Filterauswahl)
  const years = (db.prepare(`SELECT DISTINCT substr(date, 1, 4) AS y FROM (${EVENTS_SQL}) WHERE date IS NOT NULL ORDER BY y DESC`)
    .all({ u: u.id }) as { y: string }[]).map(r => r.y);
  return c.json({ events, years });
});
