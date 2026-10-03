/**
 * Import (Goodreads/StoryGraph, im Browser zu einheitlichen Einträgen aufbereitet), Wunschliste und eigene Cover.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { config } from '../config.ts';
import { requireUser, type User } from '../auth.ts';
import { router, body, str, int, oneOf, idParam, notFound } from '../util.ts';
import * as journal from '../journal.ts';
import { normalizeIsbn, fetchCover, deleteCoverFile } from '../catalog.ts';
import { importIsbn, getBook, getBookByIsbn, bookBrief, bookJson, type BookRow } from './books.ts';
import { setReading } from './reading.ts';
import { imageType } from './social.ts';
import { federate } from './reviews.ts';

export const extraRoutes = router();

// ---------- Wunschliste ----------

function wishlistOf(userId: number) {
  return (db.prepare(`
    SELECT w.note, w.created_at AS addedAt, b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover
    FROM wishlist w JOIN books b ON b.id = w.book_id WHERE w.user_id = ? ORDER BY w.created_at DESC
  `).all(userId) as Array<Record<string, unknown>>).map(r => ({ note: r.note, addedAt: r.addedAt, book: bookBrief(r) }));
}

extraRoutes.get('/wishlist', c => c.json(wishlistOf(requireUser(c).id)));

/** Wunschliste anderer: nur bei sichtbarem Regal (Geschenkideen) */
extraRoutes.get('/users/:id/wishlist', c => {
  const u = requireUser(c);
  const id = idParam(c);
  const owner = db.prepare('SELECT shelf_visible FROM users WHERE id = ? AND disabled = 0').get(id) as { shelf_visible: number } | undefined;
  if (!owner) throw notFound('Konto');
  if (!owner.shelf_visible && id !== u.id) throw new HTTPException(403, { message: 'Dieses Regal ist privat' });
  return c.json(wishlistOf(id));
});

extraRoutes.put('/books/:id/wishlist', async c => {
  const u = requireUser(c);
  const id = idParam(c);
  if (!getBook(id)) throw notFound('Buch');
  const note = str((await body(c)).note, 300);
  db.prepare(`INSERT INTO wishlist (user_id, book_id, note) VALUES (?, ?, ?) ON CONFLICT (user_id, book_id) DO UPDATE SET note = excluded.note`).run(u.id, id, note);
  return c.json({ ok: true });
});

extraRoutes.delete('/books/:id/wishlist', c => {
  const u = requireUser(c);
  db.prepare('DELETE FROM wishlist WHERE user_id = ? AND book_id = ?').run(u.id, idParam(c));
  return c.json({ ok: true });
});

// ---------- Eigene Cover ----------

/** Cover hochladen: wenn das Buch keins hat (jeder mit Exemplar), sonst nur Ersteller oder Admin */
extraRoutes.post('/books/:id/cover', async c => {
  const u = requireUser(c);
  const book = getBook(idParam(c));
  if (!book) throw notFound('Buch');
  const ownsCopy = !!db.prepare('SELECT 1 FROM copies WHERE book_id = ? AND owner_id = ? AND removed_at IS NULL').get(book.id, u.id);
  const allowed = u.is_admin || book.created_by === u.id || (!book.cover && ownsCopy);
  if (!allowed) throw new HTTPException(403, { message: 'Das Cover ersetzen dürfen nur, wer das Buch angelegt hat, und Admins' });
  const { image } = await body(c);
  const m = typeof image === 'string' ? image.match(/^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/) : null;
  const buf = m ? Buffer.from(m[2], 'base64') : null;
  const type = buf ? imageType(buf) : null;
  if (!buf || !type) throw new HTTPException(400, { message: 'Bild fehlt oder hat ein ungültiges Format' });
  if (buf.length > 1.5 * 1024 * 1024) throw new HTTPException(400, { message: 'Bild ist zu groß' });
  const name = `${book.isbn13 ?? 'b' + book.id}-own-${crypto.randomBytes(4).toString('hex')}.${type}`;
  fs.writeFileSync(path.join(config.dataDir, 'covers', name), buf);
  db.prepare('UPDATE books SET cover = ? WHERE id = ?').run(name, book.id);
  deleteCoverFile(book.cover);
  return c.json(bookJson(getBook(book.id)!));
});

// ---------- Import ----------

type ListRef = string | { name: string; createdAt?: string | null; addedAt?: string | null };
type ImportItem = {
  isbn?: string; title?: string; authors?: string[]; status?: string; rating?: number | null; review?: string | null;
  spoiler?: boolean; finishedAt?: string | null; startedAt?: string | null; addedAt?: string | null;
  owned?: boolean; format?: string; binding?: string | null; resolve?: string[]; lists?: ListRef[];
  favorite?: boolean; wishlist?: boolean; dateUnknown?: boolean;
};

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** "2025-12-22 00:07:54" oder "2025-12-22" → SQLite-Zeitstempel, sonst null */
const stamp = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v) ? (v.length === 10 ? `${v} 12:00:00` : v) : null);

async function findOrCreateBook(it: ImportItem, u: User, imp: number | null): Promise<BookRow | null> {
  const isbn = it.isbn ? normalizeIsbn(it.isbn) : null;
  const title = str(it.title, 300);
  const authors = (Array.isArray(it.authors) ? it.authors : []).map(a => str(a, 120)).filter((a): a is string => !!a).slice(0, 10);
  if (isbn) {
    const known = getBookByIsbn(isbn);
    if (known) return known;
    const found = await importIsbn(isbn, u.id);
    if (found) { if (found.created_by === u.id) journal.created(imp, 'books', { id: found.id }); return found; }
  }
  if (!title) return null;
  // ohne ISBN (oder nicht im Katalog): gleichen Titel + Autor wiederverwenden, sonst manuell anlegen
  const same = db.prepare('SELECT * FROM books WHERE lower(title) = lower(?) AND (isbn13 IS ? OR isbn13 IS NULL)').all(title, isbn) as BookRow[];
  const match = same.find(b => !authors.length || (JSON.parse(b.authors) as string[]).some(a => a.toLowerCase() === authors[0].toLowerCase()));
  if (match) return match;
  const r = db.prepare(`INSERT INTO books (isbn13, title, authors, source, created_by) VALUES (?, ?, ?, 'import', ?)`).run(isbn, title, JSON.stringify(authors), u.id);
  const id = Number(r.lastInsertRowid);
  journal.created(imp, 'books', { id });
  const cover = isbn ? await fetchCover({ isbn }).catch(() => null) : null;
  if (cover) db.prepare('UPDATE books SET cover = ? WHERE id = ?').run(cover, id);
  return getBook(id)!;
}

// ---------- Importe (Verlauf + Rückgängig) ----------

/** Neuen Import beginnen; alle Pakete eines Imports tragen diese ID */
extraRoutes.post('/imports', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const r = db.prepare('INSERT INTO imports (user_id, source, filename, total) VALUES (?, ?, ?, ?)')
    .run(u.id, str(b.source, 40) ?? 'csv', str(b.filename, 200), int(b.total, 0, 1000000) ?? 0);
  return c.json({ id: Number(r.lastInsertRowid) });
});

extraRoutes.get('/imports', c => {
  const u = requireUser(c);
  const rows = db.prepare('SELECT * FROM imports WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(u.id) as
    { id: number; source: string; filename: string | null; total: number; created_at: string; undone_at: string | null }[];
  return c.json(rows.map(r => ({ id: r.id, source: r.source, filename: r.filename, total: r.total, createdAt: r.created_at, undoneAt: r.undone_at, changes: journal.summary(r.id) })));
});

extraRoutes.post('/imports/:id/undo', c => {
  const u = requireUser(c);
  const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND user_id = ?').get(idParam(c), u.id) as { id: number; undone_at: string | null } | undefined;
  if (!imp) throw notFound('Import');
  if (imp.undone_at) throw new HTTPException(409, { message: 'Dieser Import wurde schon rückgängig gemacht' });
  const r = journal.undo(imp.id);
  // föderierte Reviews auf den anderen Instanzen nachziehen
  for (const rb of r.reviewBooks) federate(rb.bookId, rb.userId, rb.prevId);
  return c.json({ reverted: r.reverted, skipped: r.skipped });
});

/** Ein Paket (max. 10) Einträge importieren; Optionen bestimmen, was entsteht */
extraRoutes.post('/import', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const items = Array.isArray(b.items) ? (b.items as ImportItem[]).slice(0, 10) : [];
  const o = (b.options ?? {}) as Record<string, unknown>;
  const copies = oneOf(o.copies, ['owned', 'all', 'none'] as const, 'owned');
  const visibility = oneOf(o.visibility, ['private', 'instance', 'federated'] as const, 'instance');
  // Unterschiede zum Bestand: ask = melden, mine = bookshelv behalten, theirs = Import übernehmen
  const policy = oneOf(o.conflict, ['ask', 'mine', 'theirs'] as const, 'mine');
  // Journal: ohne importId wird nichts aufgezeichnet (ältere Clients) – dann ist kein Rückgängig möglich
  const imp = int(b.importId, 1, Number.MAX_SAFE_INTEGER);
  if (imp && !db.prepare('SELECT 1 FROM imports WHERE id = ? AND user_id = ? AND undone_at IS NULL').get(imp, u.id)) throw notFound('Import');
  const results = [];
  for (const it of items) {
    try {
      const book = await findOrCreateBook(it, u, imp);
      if (!book) { results.push({ title: it.title ?? '?', result: 'failed' }); continue; }
      const status = oneOf(it.status, ['read', 'reading', 'unread', 'dnf', 'want'] as const, 'unread');
      const done: string[] = [];
      const ub = { user_id: u.id, book_id: book.id };
      // Exemplar
      const wantCopy = status !== 'want' && (copies === 'all' || (copies === 'owned' && it.owned));
      const format = it.format === 'ebook' ? 'ebook' : 'print';
      if (wantCopy && !db.prepare('SELECT 1 FROM copies WHERE book_id = ? AND owner_id = ? AND format = ? AND removed_at IS NULL').get(book.id, u.id, format)) {
        const binding = format === 'print' && (it.binding === 'paperback' || it.binding === 'hardcover') ? it.binding : null;
        const added = isDate(it.addedAt) ? `${it.addedAt} 12:00:00` : null;
        const id = Number(db.prepare(`INSERT INTO copies (book_id, owner_id, format, binding, created_at, quiet) VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`)
          .run(book.id, u.id, format, binding, added, added ? 0 : 1).lastInsertRowid);
        journal.created(imp, 'copies', { id });
        done.push('copy');
      }
      // Abgleich mit dem Bestand: Lücken werden gefüllt, echte Unterschiede je nach Regel übernommen,
      // behalten oder als Konflikt zurückgemeldet (Einzelfall-Entscheidung im Browser, dann erneut mit resolve)
      const conflicts: Array<{ field: 'status' | 'finishedAt' | 'rating' | 'review'; mine: unknown; theirs: unknown }> = [];
      const take = (field: 'status' | 'finishedAt' | 'rating' | 'review', mine: unknown, theirs: unknown) => {
        if (policy === 'theirs' || (Array.isArray(it.resolve) && it.resolve.includes(field))) return true;
        if (policy === 'ask') conflicts.push({ field, mine, theirs });
        return false;
      };
      // Wunschliste (auch zusätzlich zu einem Lesestand, z. B. Booky „wishlist“)
      const onShelf = () => !!db.prepare('SELECT 1 FROM copies WHERE book_id = ? AND owner_id = ? AND removed_at IS NULL').get(book.id, u.id);
      const cur = db.prepare('SELECT status, finished_at FROM user_books WHERE user_id = ? AND book_id = ?').get(u.id, book.id) as { status: string; finished_at: string | null } | undefined;
      if ((status === 'want' || it.wishlist) && o.wishlist !== false && !onShelf() && (status !== 'want' || !cur || cur.status === 'unread')) {
        if (db.prepare('INSERT OR IGNORE INTO wishlist (user_id, book_id) VALUES (?, ?)').run(u.id, book.id).changes) { journal.created(imp, 'wishlist', ub); done.push('wishlist'); }
      }
      // Lesestand
      const finishedAt = isDate(it.finishedAt) ? it.finishedAt : undefined;
      if (status !== 'unread' && status !== 'want') {
        const mineStatus = cur?.status ?? 'unread';
        if (mineStatus !== status && (mineStatus === 'unread' || take('status', mineStatus, status))) {
          journal.before(imp, 'user_books', ub);
          // Import: unbekannte Daten bleiben leer statt „heute“ (sonst stünde im Feed alles als heute gelesen)
          setReading(u.id, book.id, {
            status, startedAt: isDate(it.startedAt) ? it.startedAt : null,
            finishedAt: status === 'read' || status === 'dnf' ? finishedAt ?? null : undefined
          });
          done.push('status');
        } else if (mineStatus === status && (status === 'read' || status === 'dnf') && finishedAt && cur?.finished_at !== finishedAt
          && (!cur?.finished_at || take('finishedAt', cur.finished_at, finishedAt))) {
          journal.before(imp, 'user_books', ub);
          setReading(u.id, book.id, { finishedAt });
          done.push('status');
        }
      }
      // Favorit (♥) – nur setzen, nie wegnehmen
      if (it.favorite && !(db.prepare('SELECT favorite FROM user_books WHERE user_id = ? AND book_id = ?').get(u.id, book.id) as { favorite: number } | undefined)?.favorite) {
        journal.before(imp, 'user_books', ub);
        setReading(u.id, book.id, { favorite: true });
        done.push('favorite');
      }
      // Bewertung
      const rating = typeof it.rating === 'number' && it.rating >= 0.5 && it.rating <= 5 ? Math.round(it.rating * 2) / 2 : null;
      const text = str(it.review, 10000);
      if (o.reviews !== false && (rating || text)) {
        const rev = db.prepare('SELECT id, rating, text FROM reviews WHERE book_id = ? AND user_id = ?').get(book.id, u.id) as { id: number; rating: number | null; text: string | null } | undefined;
        if (!rev) {
          // Zeitpunkt der Bewertung = gelesen am (bzw. hinzugefügt am); ohne Datum still (nicht im Feed)
          const when = finishedAt ?? (isDate(it.addedAt) ? it.addedAt : null);
          const ts = when ? `${when} 12:00:00` : null;
          const id = Number(db.prepare(`INSERT INTO reviews (book_id, user_id, rating, text, visibility, spoiler, created_at, updated_at, quiet)
            VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?)`)
            .run(book.id, u.id, rating, text, visibility, it.spoiler ? 1 : 0, ts, ts, ts ? 0 : 1).lastInsertRowid);
          journal.created(imp, 'reviews', { id });
          federate(book.id, u.id, null);
          done.push('review');
        } else {
          let newRating = rev.rating, newText = rev.text;
          if (rating && rating !== rev.rating && (rev.rating === null || take('rating', rev.rating, rating))) newRating = rating;
          if (text && text !== rev.text && (!rev.text || take('review', rev.text, text))) newText = text;
          if (newRating !== rev.rating || newText !== rev.text) {
            journal.before(imp, 'reviews', { id: rev.id });
            // Abgleich ändert den Zeitpunkt nicht – sonst stünde die alte Bewertung als „heute bewertet“ im Feed
            db.prepare('UPDATE reviews SET rating = ?, text = ? WHERE id = ?').run(newRating, newText, rev.id);
            federate(book.id, u.id, null);
            done.push('review');
          }
        }
      }
      // Regale/Tags/Listen der anderen App → Leselisten (gleicher Name wird wiederverwendet, Daten aus der Datei)
      if (o.lists !== false && Array.isArray(it.lists)) {
        for (const ref of it.lists.slice(0, 20)) {
          const r = typeof ref === 'string' ? { name: ref } : ref;
          const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 80) : '';
          if (!name) continue;
          let list = db.prepare('SELECT id FROM lists WHERE user_id = ? AND lower(name) = lower(?)').get(u.id, name) as { id: number } | undefined;
          if (!list) {
            const t = stamp((r as { createdAt?: string }).createdAt);
            list = { id: Number(db.prepare("INSERT INTO lists (user_id, name, visibility, created_at, updated_at) VALUES (?, ?, 'private', COALESCE(?, datetime('now')), datetime('now'))").run(u.id, name, t).lastInsertRowid) };
            journal.created(imp, 'lists', { id: list.id });
          }
          const pos = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM list_items WHERE list_id = ?').get(list.id) as { p: number }).p;
          const added = stamp((r as { addedAt?: string }).addedAt);
          if (db.prepare("INSERT OR IGNORE INTO list_items (list_id, book_id, position, added_at, quiet) VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?)").run(list.id, book.id, pos, added, added ? 0 : 1).changes) {
            journal.created(imp, 'list_items', { list_id: list.id, book_id: book.id });
            done.push('list');
          }
        }
      }
      if (conflicts.length) { results.push({ title: book.title, bookId: book.id, result: 'conflict', done, conflicts }); continue; }
      results.push({ title: book.title, bookId: book.id, result: done.length ? 'ok' : 'exists', done });
    } catch {
      results.push({ title: it.title ?? '?', result: 'failed' });
    }
  }
  return c.json({ results });
});
