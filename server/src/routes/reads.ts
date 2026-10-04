/**
 * Leserunden (gemeinsam lesen, wie StoryGraph „Buddy Reads“): ein Buch, bis zu 20 Personen der Instanz.
 * Beiträge tragen eine Position in Prozent (aus Seite oder aktuellem Fortschritt). Spoilerschutz serverseitig:
 * Beiträge hinter dem eigenen Lesestand kommen ohne Text an („bei S. 120 – lies weiter“). Fertig gelesen = 100 %.
 * Besitzer*in lädt ein, entfernt und löscht; Mitglieder können austreten.
 */
import { HTTPException } from 'hono/http-exception';
import { db, tx } from '../db.ts';
import { requireUser, type User } from '../auth.ts';
import { router, body, str, int, idParam, notFound } from '../util.ts';
import { bookBrief, getBook } from './books.ts';
import { notify } from '../notify.ts';
import { avatarUrl } from './social.ts';

export const readRoutes = router();

const MAX_MEMBERS = 20;
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

type ReadRow = { id: number; book_id: number; owner_id: number; note: string | null; ends_at: string | null; created_at: string };

/** Lesestand einer Person in Prozent (gelesen = 100) */
export function positionOf(userId: number, bookId: number): number {
  const r = db.prepare(`SELECT ub.status, ub.progress, b.pages FROM books b LEFT JOIN user_books ub ON ub.book_id = b.id AND ub.user_id = ? WHERE b.id = ?`)
    .get(userId, bookId) as { status: string | null; progress: number | null; pages: number | null } | undefined;
  if (!r) return 0;
  if (r.status === 'read') return 100;
  return r.progress ? Math.min(100, Math.round((r.progress / (r.pages || 100)) * 100)) : 0;
}

const isMember = (readId: number, userId: number) => !!db.prepare('SELECT 1 FROM buddy_members WHERE read_id = ? AND user_id = ?').get(readId, userId);

function readFor(u: User, id: number) {
  const r = db.prepare('SELECT * FROM buddy_reads WHERE id = ?').get(id) as ReadRow | undefined;
  if (!r || !isMember(r.id, u.id)) throw notFound('Leserunde');
  return r;
}

function membersOf(r: ReadRow) {
  return (db.prepare(`
    SELECT u.id, u.display_name AS displayName, u.avatar, m.joined_at AS joinedAt FROM buddy_members m JOIN users u ON u.id = m.user_id
    WHERE m.read_id = ? ORDER BY u.display_name
  `).all(r.id) as { id: number; displayName: string; avatar: string | null; joinedAt: string }[])
    .map(m => ({ id: m.id, displayName: m.displayName, avatarUrl: avatarUrl(m.avatar), owner: m.id === r.owner_id, position: positionOf(m.id, r.book_id) }))
    .sort((a, b) => b.position - a.position);
}

function bookOf(bookId: number) {
  const b = getBook(bookId)!;
  return bookBrief({ bookId: b.id, title: b.title, subtitle: b.subtitle, authors: b.authors, year: b.year, pages: b.pages, cover: b.cover });
}

/** Meine Leserunden (für Übersicht, Startseite und Buchseite mit ?book=) */
readRoutes.get('/reads', c => {
  const u = requireUser(c);
  const bookId = Number(c.req.query('book')) || null;
  const rows = db.prepare(`
    SELECT r.*, m.seen_at,
           (SELECT COUNT(*) FROM buddy_posts p WHERE p.read_id = r.id) AS posts,
           (SELECT COUNT(*) FROM buddy_posts p WHERE p.read_id = r.id AND p.user_id != :u AND (m.seen_at IS NULL OR p.created_at > m.seen_at)) AS unseen
    FROM buddy_reads r JOIN buddy_members m ON m.read_id = r.id AND m.user_id = :u
    ${bookId ? 'WHERE r.book_id = :b' : ''}
    ORDER BY r.created_at DESC LIMIT 100
  `).all(bookId ? { u: u.id, b: bookId } : { u: u.id }) as Array<ReadRow & { posts: number; unseen: number }>;
  return c.json(rows.map(r => ({
    id: r.id, note: r.note, endsAt: r.ends_at, createdAt: r.created_at, posts: r.posts, unseen: r.unseen,
    mine: r.owner_id === u.id, book: bookOf(r.book_id), members: membersOf(r), myPosition: positionOf(u.id, r.book_id)
  })));
});

readRoutes.post('/reads', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const bookId = int(b.bookId, 1, Number.MAX_SAFE_INTEGER);
  if (!bookId || !getBook(bookId)) throw notFound('Buch');
  const ids = [...new Set((Array.isArray(b.memberIds) ? b.memberIds : []).map(Number).filter(n => Number.isInteger(n) && n !== u.id))];
  if (ids.length >= MAX_MEMBERS) throw new HTTPException(400, { message: `Höchstens ${MAX_MEMBERS} Personen` });
  const valid = ids.filter(id => db.prepare('SELECT 1 FROM users WHERE id = ? AND disabled = 0').get(id));
  const endsAt = isDate(b.endsAt) ? b.endsAt as string : null;
  const id = tx(() => {
    const id = Number(db.prepare('INSERT INTO buddy_reads (book_id, owner_id, note, ends_at) VALUES (?, ?, ?, ?)').run(bookId, u.id, str(b.note, 300), endsAt).lastInsertRowid);
    const add = db.prepare('INSERT OR IGNORE INTO buddy_members (read_id, user_id) VALUES (?, ?)');
    add.run(id, u.id);
    for (const m of valid) add.run(id, m);
    return id;
  });
  for (const m of valid) notify(m, 'buddy_invite', u.id, bookId, id);
  return c.json({ id });
});

readRoutes.get('/reads/:id', c => {
  const u = requireUser(c);
  const r = readFor(u, idParam(c));
  const me = positionOf(u.id, r.book_id);
  const posts = (db.prepare(`
    SELECT p.*, u.display_name AS name, u.avatar FROM buddy_posts p JOIN users u ON u.id = p.user_id
    WHERE p.read_id = ? ORDER BY p.position, p.created_at
  `).all(r.id) as Array<{ id: number; user_id: number; position: number; page: number | null; text: string; created_at: string; name: string; avatar: string | null }>)
    .map(p => {
      const visible = p.user_id === u.id || p.position <= me;
      return {
        id: p.id, position: p.position, page: p.page, createdAt: p.created_at, locked: !visible, text: visible ? p.text : null,
        mine: p.user_id === u.id, user: { id: p.user_id, displayName: p.name, avatarUrl: avatarUrl(p.avatar) }
      };
    });
  db.prepare(`UPDATE buddy_members SET seen_at = datetime('now') WHERE read_id = ? AND user_id = ?`).run(r.id, u.id);
  return c.json({
    id: r.id, note: r.note, endsAt: r.ends_at, createdAt: r.created_at, mine: r.owner_id === u.id,
    book: bookOf(r.book_id), members: membersOf(r), myPosition: me, posts
  });
});

readRoutes.patch('/reads/:id', async c => {
  const u = requireUser(c);
  const r = readFor(u, idParam(c));
  if (r.owner_id !== u.id) throw notFound('Leserunde');
  const b = await body(c);
  db.prepare('UPDATE buddy_reads SET note = ?, ends_at = ? WHERE id = ?').run(
    b.note === undefined ? r.note : str(b.note, 300), b.endsAt === undefined ? r.ends_at : isDate(b.endsAt) ? b.endsAt as string : null, r.id);
  return c.json({ ok: true });
});

readRoutes.delete('/reads/:id', c => {
  const u = requireUser(c);
  const r = readFor(u, idParam(c));
  if (r.owner_id !== u.id) throw notFound('Leserunde');
  db.prepare('DELETE FROM buddy_reads WHERE id = ?').run(r.id);
  return c.json({ ok: true });
});

readRoutes.post('/reads/:id/members', async c => {
  const u = requireUser(c);
  const r = readFor(u, idParam(c));
  if (r.owner_id !== u.id) throw notFound('Leserunde');
  const userId = int((await body(c)).userId, 1, Number.MAX_SAFE_INTEGER);
  if (!userId || !db.prepare('SELECT 1 FROM users WHERE id = ? AND disabled = 0').get(userId)) throw notFound('Konto');
  const n = (db.prepare('SELECT COUNT(*) AS n FROM buddy_members WHERE read_id = ?').get(r.id) as { n: number }).n;
  if (n >= MAX_MEMBERS) throw new HTTPException(400, { message: `Höchstens ${MAX_MEMBERS} Personen` });
  if (db.prepare('INSERT OR IGNORE INTO buddy_members (read_id, user_id) VALUES (?, ?)').run(r.id, userId).changes) notify(userId, 'buddy_invite', u.id, r.book_id, r.id);
  return c.json({ ok: true });
});

/** Entfernen (Besitzer*in) oder selbst austreten; die Besitzer*in kann nicht austreten, nur löschen */
readRoutes.delete('/reads/:id/members/:userId', c => {
  const u = requireUser(c);
  const r = readFor(u, idParam(c));
  const userId = Number(c.req.param('userId'));
  if (userId !== u.id && r.owner_id !== u.id) throw notFound('Leserunde');
  if (userId === r.owner_id) throw new HTTPException(400, { message: 'Die Leserunde gehört dir – löschen statt austreten' });
  db.prepare('DELETE FROM buddy_members WHERE read_id = ? AND user_id = ?').run(r.id, userId);
  return c.json({ ok: true });
});

/** Beitrag: Position aus Seite (wenn das Buch Seiten hat), sonst aus Prozent, sonst aktueller eigener Lesestand */
readRoutes.post('/reads/:id/posts', async c => {
  const u = requireUser(c);
  const r = readFor(u, idParam(c));
  const b = await body(c);
  const text = str(b.text, 2000);
  if (!text) throw new HTTPException(400, { message: 'Text fehlt' });
  const pages = getBook(r.book_id)!.pages;
  const page = pages ? int(b.page, 0, pages) : null;
  const pct = int(b.percent, 0, 100);
  const position = page != null && pages ? Math.round((page / pages) * 100) : pct ?? positionOf(u.id, r.book_id);
  const id = Number(db.prepare('INSERT INTO buddy_posts (read_id, user_id, position, page, text) VALUES (?, ?, ?, ?, ?)').run(r.id, u.id, position, page, text).lastInsertRowid);
  // nur wer den Beitrag schon lesen darf, bekommt eine Glocke (sonst wäre es ein Spoiler-Köder)
  const others = db.prepare('SELECT user_id FROM buddy_members WHERE read_id = ? AND user_id != ?').all(r.id, u.id) as { user_id: number }[];
  const exists = db.prepare(`SELECT 1 FROM notifications WHERE user_id = ? AND type = 'buddy_post' AND ref_id = ? AND read_at IS NULL`);
  for (const o of others) if (positionOf(o.user_id, r.book_id) >= position && !exists.get(o.user_id, r.id)) notify(o.user_id, 'buddy_post', u.id, r.book_id, r.id);
  return c.json({ id, position });
});

readRoutes.delete('/reads/:id/posts/:postId', c => {
  const u = requireUser(c);
  const r = readFor(u, idParam(c));
  const p = db.prepare('SELECT user_id FROM buddy_posts WHERE id = ? AND read_id = ?').get(Number(c.req.param('postId')), r.id) as { user_id: number } | undefined;
  if (!p || (p.user_id !== u.id && r.owner_id !== u.id)) throw notFound('Beitrag');
  db.prepare('DELETE FROM buddy_posts WHERE id = ?').run(Number(c.req.param('postId')));
  return c.json({ ok: true });
});
