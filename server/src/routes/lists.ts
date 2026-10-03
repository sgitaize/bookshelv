/**
 * Leselisten (wie Playlists, z. B. „Herbst 26“) und die Top 5 im Profil.
 */
import { HTTPException } from 'hono/http-exception';
import { db, tx } from '../db.ts';
import { requireUser } from '../auth.ts';
import { router, body, str, oneOf, idParam, notFound } from '../util.ts';
import { bookBrief, getBook } from './books.ts';

export const listRoutes = router();

const MAX_ITEMS = 500;

type ListRow = { id: number; user_id: number; name: string; description: string | null; visibility: 'private' | 'instance'; created_at: string; updated_at: string };

const BRIEF = 'b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover';

/** Listen eines Nutzers mit Anzahl und den ersten vier Covern (für die Kachel) */
export function listsOf(ownerId: number, includePrivate: boolean) {
  const rows = db.prepare(`
    SELECT l.*, (SELECT COUNT(*) FROM list_items WHERE list_id = l.id) AS n
    FROM lists l WHERE l.user_id = ? ${includePrivate ? '' : "AND l.visibility = 'instance'"}
    ORDER BY l.updated_at DESC
  `).all(ownerId) as Array<ListRow & { n: number }>;
  const covers = db.prepare(`SELECT ${BRIEF} FROM list_items li JOIN books b ON b.id = li.book_id WHERE li.list_id = ? ORDER BY li.position LIMIT 4`);
  return rows.map(l => ({
    id: l.id, name: l.name, description: l.description, visibility: l.visibility, updatedAt: l.updated_at, count: l.n,
    preview: (covers.all(l.id) as Array<Record<string, unknown>>).map(bookBrief)
  }));
}

/** Liste laden und Sichtbarkeit prüfen (privat: nur Besitzer; Regal privat: Listen auch) */
function visibleList(viewerId: number, id: number) {
  const l = db.prepare('SELECT l.*, u.shelf_visible, u.display_name, u.username FROM lists l JOIN users u ON u.id = l.user_id WHERE l.id = ? AND u.disabled = 0').get(id) as
    (ListRow & { shelf_visible: number; display_name: string; username: string }) | undefined;
  if (!l || (l.user_id !== viewerId && (l.visibility === 'private' || !l.shelf_visible))) throw notFound('Liste');
  return l;
}

function ownList(userId: number, id: number) {
  const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(id) as ListRow | undefined;
  if (!l || l.user_id !== userId) throw notFound('Liste');
  return l;
}

const touch = (id: number) => db.prepare("UPDATE lists SET updated_at = datetime('now') WHERE id = ?").run(id);

listRoutes.get('/lists', c => c.json(listsOf(requireUser(c).id, true)));

listRoutes.get('/users/:id/lists', c => {
  const u = requireUser(c);
  const id = idParam(c);
  const owner = db.prepare('SELECT shelf_visible FROM users WHERE id = ? AND disabled = 0').get(id) as { shelf_visible: number } | undefined;
  if (!owner) throw notFound('Nutzer');
  if (!owner.shelf_visible && id !== u.id) return c.json([]);
  return c.json(listsOf(id, id === u.id));
});

listRoutes.post('/lists', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const name = str(b.name, 80);
  if (!name) throw new HTTPException(400, { message: 'Name fehlt' });
  if ((db.prepare('SELECT COUNT(*) AS n FROM lists WHERE user_id = ?').get(u.id) as { n: number }).n >= 200) throw new HTTPException(400, { message: 'Höchstens 200 Listen' });
  const r = db.prepare('INSERT INTO lists (user_id, name, description, visibility) VALUES (?, ?, ?, ?)')
    .run(u.id, name, str(b.description, 1000), oneOf(b.visibility, ['private', 'instance'] as const, 'instance'));
  const id = Number(r.lastInsertRowid);
  // optional gleich ein Buch aufnehmen (aus dem „Zur Liste“-Dialog)
  if (typeof b.bookId === 'number' && getBook(b.bookId)) db.prepare('INSERT INTO list_items (list_id, book_id, position) VALUES (?, ?, 1)').run(id, b.bookId);
  return c.json({ id });
});

listRoutes.get('/lists/:id', c => {
  const u = requireUser(c);
  const l = visibleList(u.id, idParam(c));
  const items = (db.prepare(`
    SELECT ${BRIEF}, li.note, li.added_at AS addedAt, li.position, ub.status AS myStatus
    FROM list_items li JOIN books b ON b.id = li.book_id
    LEFT JOIN user_books ub ON ub.book_id = b.id AND ub.user_id = ?
    WHERE li.list_id = ? ORDER BY li.position
  `).all(u.id, l.id) as Array<Record<string, unknown>>).map(r => ({
    note: r.note, addedAt: r.addedAt, myStatus: r.myStatus ?? 'unread', book: bookBrief(r)
  }));
  return c.json({
    id: l.id, name: l.name, description: l.description, visibility: l.visibility, createdAt: l.created_at, updatedAt: l.updated_at,
    mine: l.user_id === u.id, owner: { id: l.user_id, displayName: l.display_name, username: l.username }, items
  });
});

listRoutes.patch('/lists/:id', async c => {
  const u = requireUser(c);
  const l = ownList(u.id, idParam(c));
  const b = await body(c);
  const name = b.name === undefined ? l.name : str(b.name, 80);
  if (!name) throw new HTTPException(400, { message: 'Name fehlt' });
  db.prepare("UPDATE lists SET name = ?, description = ?, visibility = ?, updated_at = datetime('now') WHERE id = ?").run(
    name, b.description === undefined ? l.description : str(b.description, 1000),
    b.visibility === undefined ? l.visibility : oneOf(b.visibility, ['private', 'instance'] as const, 'instance'), l.id);
  return c.json({ ok: true });
});

listRoutes.delete('/lists/:id', c => {
  const u = requireUser(c);
  db.prepare('DELETE FROM lists WHERE id = ?').run(ownList(u.id, idParam(c)).id);
  return c.json({ ok: true });
});

listRoutes.put('/lists/:id/books/:bookId', async c => {
  const u = requireUser(c);
  const l = ownList(u.id, idParam(c));
  const bookId = idParam(c, 'bookId');
  if (!getBook(bookId)) throw notFound('Buch');
  const note = str((await body(c)).note, 300);
  const cur = db.prepare('SELECT COUNT(*) AS n, MAX(position) AS p FROM list_items WHERE list_id = ?').get(l.id) as { n: number; p: number | null };
  if (cur.n >= MAX_ITEMS) throw new HTTPException(400, { message: 'Liste ist voll (max. 500 Bücher)' });
  db.prepare(`INSERT INTO list_items (list_id, book_id, position, note) VALUES (?, ?, ?, ?)
    ON CONFLICT (list_id, book_id) DO UPDATE SET note = COALESCE(excluded.note, note)`).run(l.id, bookId, (cur.p ?? 0) + 1, note);
  touch(l.id);
  return c.json({ ok: true });
});

listRoutes.delete('/lists/:id/books/:bookId', c => {
  const u = requireUser(c);
  const l = ownList(u.id, idParam(c));
  db.prepare('DELETE FROM list_items WHERE list_id = ? AND book_id = ?').run(l.id, idParam(c, 'bookId'));
  touch(l.id);
  return c.json({ ok: true });
});

/** Reihenfolge setzen: alle Buch-IDs der Liste in neuer Reihenfolge */
listRoutes.put('/lists/:id/order', async c => {
  const u = requireUser(c);
  const l = ownList(u.id, idParam(c));
  const ids = (await body(c)).bookIds;
  if (!Array.isArray(ids) || !ids.every(Number.isInteger)) throw new HTTPException(400, { message: 'Ungültige Anfrage (JSON erwartet)' });
  tx(() => {
    const set = db.prepare('UPDATE list_items SET position = ? WHERE list_id = ? AND book_id = ?');
    (ids as number[]).slice(0, MAX_ITEMS).forEach((id, i) => set.run(i + 1, l.id, id));
  });
  touch(l.id);
  return c.json({ ok: true });
});

/** Eigene Listen mit Markierung, ob das Buch schon drin ist (für den Dialog auf der Buchseite) */
listRoutes.get('/books/:id/lists', c => {
  const u = requireUser(c);
  const bookId = idParam(c);
  const mine = db.prepare(`
    SELECT l.id, l.name, l.visibility, EXISTS (SELECT 1 FROM list_items WHERE list_id = l.id AND book_id = ?) AS has
    FROM lists l WHERE l.user_id = ? ORDER BY l.updated_at DESC
  `).all(bookId, u.id) as Array<{ id: number; name: string; visibility: string; has: number }>;
  // Listen anderer, in denen das Buch steht
  const others = db.prepare(`
    SELECT l.id, l.name, u.display_name AS ownerName FROM list_items li JOIN lists l ON l.id = li.list_id JOIN users u ON u.id = l.user_id
    WHERE li.book_id = ? AND l.user_id != ? AND l.visibility = 'instance' AND u.shelf_visible = 1 AND u.disabled = 0
    ORDER BY l.updated_at DESC LIMIT 20
  `).all(bookId, u.id);
  return c.json({ mine: mine.map(l => ({ ...l, has: !!l.has })), others });
});

// ---------- Top 5 ----------

export function topOf(userId: number) {
  return (db.prepare(`SELECT ${BRIEF} FROM user_books ub JOIN books b ON b.id = ub.book_id WHERE ub.user_id = ? AND ub.top_rank IS NOT NULL ORDER BY ub.top_rank`)
    .all(userId) as Array<Record<string, unknown>>).map(bookBrief);
}

listRoutes.get('/me/top', c => c.json(topOf(requireUser(c).id)));

/** Top 5 komplett ersetzen (Reihenfolge = Rang) */
listRoutes.put('/me/top', async c => {
  const u = requireUser(c);
  const ids = (await body(c)).bookIds;
  if (!Array.isArray(ids) || ids.length > 5 || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length)
    throw new HTTPException(400, { message: 'Höchstens 5 verschiedene Bücher' });
  for (const id of ids as number[]) if (!getBook(id)) throw notFound('Buch');
  tx(() => {
    db.prepare('UPDATE user_books SET top_rank = NULL WHERE user_id = ? AND top_rank IS NOT NULL').run(u.id);
    (ids as number[]).forEach((id, i) => {
      db.prepare(`INSERT INTO user_books (user_id, book_id, top_rank) VALUES (?, ?, ?)
        ON CONFLICT (user_id, book_id) DO UPDATE SET top_rank = excluded.top_rank`).run(u.id, id, i + 1);
    });
  });
  return c.json(topOf(u.id));
});

/** Auswahl für Top 5 und Leselisten: Bücher, mit denen ich etwas zu tun habe (gelesen zuerst), optional gefiltert */
listRoutes.get('/me/books', c => {
  const u = requireUser(c);
  const q = `%${(c.req.query('q') ?? '').trim().toLowerCase().slice(0, 100)}%`;
  return c.json((db.prepare(`
    SELECT ${BRIEF}, COALESCE(ub.status, 'unread') AS status FROM books b
    LEFT JOIN user_books ub ON ub.book_id = b.id AND ub.user_id = :u
    WHERE (ub.status IN ('read', 'reading', 'dnf') OR ub.favorite = 1
      OR EXISTS (SELECT 1 FROM copies WHERE book_id = b.id AND owner_id = :u AND removed_at IS NULL)
      OR EXISTS (SELECT 1 FROM wishlist WHERE book_id = b.id AND user_id = :u))
      AND (lower(b.title) LIKE :q OR lower(b.authors) LIKE :q)
    ORDER BY CASE ub.status WHEN 'read' THEN 0 WHEN 'reading' THEN 1 ELSE 2 END, ub.favorite DESC, ub.finished_at DESC, b.title COLLATE NOCASE
    LIMIT 60
  `).all({ u: u.id, q }) as Array<Record<string, unknown>>).map(r => ({ status: r.status, book: bookBrief(r) })));
});
