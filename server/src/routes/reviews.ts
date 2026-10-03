/**
 * Reviews (½–5 Sterne + Text) und Kommentare.
 * Sichtbarkeit: private = nur ich, instance = alle auf dieser Instanz, federated = zusätzlich gekoppelte Instanzen (Iteration 5).
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { requireUser, type User } from '../auth.ts';
import { router, body, str, oneOf, idParam, notFound } from '../util.ts';
import { getBook, bookBrief } from './books.ts';
import { notify } from '../notify.ts';
import { avatarUrl } from './social.ts';

export const reviewRoutes = router();

const VISIBILITY = ['private', 'instance', 'federated'] as const;

/** Bewertung in halben Schritten oder null */
function rating(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0.5 || n > 5 || Math.round(n * 2) !== n * 2)
    throw new HTTPException(400, { message: 'Bewertung: 0,5 bis 5 Sterne in halben Schritten' });
  return n;
}

/** Sichtbare Reviews: eigene immer, fremde nur, wenn nicht privat und das Konto aktiv ist */
const VISIBLE = `(r.user_id = ? OR (r.visibility != 'private' AND u.disabled = 0))`;

type ReviewRow = {
  id: number; book_id: number; user_id: number; rating: number | null; text: string | null; visibility: string;
  spoiler: number; created_at: string; updated_at: string; displayName: string; username: string; avatar?: string | null;
};

function reviewJson(r: ReviewRow, me: User, comments: Array<Record<string, unknown>> = []) {
  return {
    id: r.id, bookId: r.book_id, rating: r.rating, text: r.text, visibility: r.visibility, spoiler: !!r.spoiler,
    createdAt: r.created_at, updatedAt: r.updated_at, mine: r.user_id === me.id,
    user: { id: r.user_id, displayName: r.displayName, username: r.username, avatarUrl: avatarUrl(r.avatar) },
    comments: comments.map(c => ({
      id: c.id, text: c.text, createdAt: c.created_at,
      user: { id: c.user_id, displayName: c.displayName, avatarUrl: avatarUrl(c.avatar) },
      canDelete: c.user_id === me.id || r.user_id === me.id || !!me.is_admin
    }))
  };
}

const commentsFor = (reviewIds: number[]) => {
  if (!reviewIds.length) return new Map<number, Array<Record<string, unknown>>>();
  const rows = db.prepare(`
    SELECT c.*, u.display_name AS displayName, u.avatar FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.review_id IN (${reviewIds.map(() => '?').join(',')}) ORDER BY c.created_at, c.id
  `).all(...reviewIds) as Array<Record<string, unknown>>;
  const map = new Map<number, Array<Record<string, unknown>>>();
  for (const r of rows) map.set(r.review_id as number, [...(map.get(r.review_id as number) ?? []), r]);
  return map;
};

/** Reviews eines Buchs inkl. Durchschnitt (nur sichtbare Bewertungen zählen) */
export function bookReviews(bookId: number, me: User) {
  const rows = db.prepare(`
    SELECT r.*, u.display_name AS displayName, u.username, u.avatar FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.book_id = ? AND ${VISIBLE} ORDER BY r.user_id = ? DESC, r.updated_at DESC
  `).all(bookId, me.id, me.id) as ReviewRow[];
  const comments = commentsFor(rows.map(r => r.id));
  const rated = rows.filter(r => r.rating !== null);
  return {
    average: rated.length ? Math.round((rated.reduce((a, r) => a + r.rating!, 0) / rated.length) * 100) / 100 : null,
    count: rated.length,
    reviews: rows.map(r => reviewJson(r, me, comments.get(r.id)))
  };
}

reviewRoutes.get('/books/:id/reviews', c => {
  const u = requireUser(c);
  const id = idParam(c);
  if (!getBook(id)) throw notFound('Buch');
  return c.json(bookReviews(id, u));
});

/** Eigene Review anlegen/ändern; ohne Sterne und Text wird sie gelöscht */
reviewRoutes.put('/books/:id/review', async c => {
  const u = requireUser(c);
  const id = idParam(c);
  if (!getBook(id)) throw notFound('Buch');
  const b = await body(c);
  const r = rating(b.rating);
  const text = str(b.text, 10000);
  if (r === null && !text) {
    db.prepare('DELETE FROM reviews WHERE book_id = ? AND user_id = ?').run(id, u.id);
    return c.json(bookReviews(id, u));
  }
  // "federated" wird gespeichert, wirkt aber erst mit der Föderation (bis dahin wie "instance")
  const visibility = oneOf(b.visibility, VISIBILITY, 'instance');
  db.prepare(`
    INSERT INTO reviews (book_id, user_id, rating, text, visibility, spoiler) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (book_id, user_id) DO UPDATE SET rating = excluded.rating, text = excluded.text,
      visibility = excluded.visibility, spoiler = excluded.spoiler, updated_at = datetime('now')
  `).run(id, u.id, r, text, visibility, b.spoiler ? 1 : 0);
  return c.json(bookReviews(id, u));
});

reviewRoutes.delete('/books/:id/review', c => {
  const u = requireUser(c);
  const id = idParam(c);
  db.prepare('DELETE FROM reviews WHERE book_id = ? AND user_id = ?').run(id, u.id);
  return c.json(bookReviews(id, u));
});

// ---------- Kommentare ----------

reviewRoutes.post('/reviews/:id/comments', async c => {
  const u = requireUser(c);
  const review = db.prepare(`
    SELECT r.id, r.book_id, r.user_id FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.id = ? AND ${VISIBLE}
  `).get(idParam(c), u.id) as { id: number; book_id: number; user_id: number } | undefined;
  if (!review) throw notFound('Review');
  const text = str((await body(c)).text, 2000);
  if (!text) throw new HTTPException(400, { message: 'Kommentar ist leer' });
  db.prepare('INSERT INTO comments (review_id, user_id, text) VALUES (?, ?, ?)').run(review.id, u.id, text);
  notify(review.user_id, 'comment', u.id, review.book_id, review.id);
  return c.json(bookReviews(review.book_id, u));
});

reviewRoutes.delete('/comments/:id', c => {
  const u = requireUser(c);
  const row = db.prepare(`
    SELECT c.id, c.user_id, r.user_id AS review_user, r.book_id FROM comments c JOIN reviews r ON r.id = c.review_id WHERE c.id = ?
  `).get(idParam(c)) as { id: number; user_id: number; review_user: number; book_id: number } | undefined;
  if (!row) throw notFound('Kommentar');
  // löschen darf: wer ihn geschrieben hat, wem die Review gehört, Admins
  if (row.user_id !== u.id && row.review_user !== u.id && !u.is_admin) throw new HTTPException(403, { message: 'Nicht erlaubt' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(row.id);
  return c.json(bookReviews(row.book_id, u));
});

// ---------- Neues aus dem Freundeskreis ----------

/** Letzte Reviews anderer (für die Startseite) */
reviewRoutes.get('/reviews/recent', c => {
  const u = requireUser(c);
  const rows = db.prepare(`
    SELECT r.*, u.display_name AS displayName, u.username, u.avatar,
           b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover,
           (SELECT COUNT(*) FROM comments WHERE review_id = r.id) AS commentCount
    FROM reviews r JOIN users u ON u.id = r.user_id JOIN books b ON b.id = r.book_id
    WHERE r.user_id != ? AND r.visibility != 'private' AND u.disabled = 0
    ORDER BY r.updated_at DESC LIMIT 15
  `).all(u.id) as Array<ReviewRow & Record<string, unknown>>;
  return c.json(rows.map(r => ({
    ...reviewJson(r, u), commentCount: r.commentCount, book: bookBrief(r),
    // Spoiler-Text nicht in der Übersicht ausliefern
    text: r.spoiler ? null : r.text && r.text.length > 280 ? r.text.slice(0, 280) + '…' : r.text
  })));
});

/** Eigene Reviews (Profil, Export) */
reviewRoutes.get('/users/:id/reviews', c => {
  const u = requireUser(c);
  const id = idParam(c);
  const rows = db.prepare(`
    SELECT r.*, u.display_name AS displayName, u.username, u.avatar, b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover
    FROM reviews r JOIN users u ON u.id = r.user_id JOIN books b ON b.id = r.book_id
    WHERE r.user_id = ? AND ${VISIBLE} ORDER BY r.updated_at DESC LIMIT 100
  `).all(id, u.id) as Array<ReviewRow & Record<string, unknown>>;
  return c.json(rows.map(r => ({ ...reviewJson(r, u), book: bookBrief(r) })));
});
