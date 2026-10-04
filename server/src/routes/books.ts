import fs from 'node:fs';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { wishAvailable } from '../notify.ts';
import { requireUser, type User } from '../auth.ts';
import { lookupIsbn, normalizeIsbn, searchCatalog, fetchCover, previewCover, deleteCoverFile, type BookData } from '../catalog.ts';
import { router, body, str, int, oneOf, idParam, notFound } from '../util.ts';
import { setReading, readingJson, READ_STATUS, today, type ReadingRow } from './reading.ts';
import { openLoanFor } from './loans.ts';

export const bookRoutes = router();

export type BookRow = {
  id: number; isbn13: string | null; title: string; subtitle: string | null; authors: string; publisher: string | null;
  year: number | null; pages: number | null; language: string | null; subjects: string; cover: string | null;
  source: string | null; created_by: number | null; series: string | null; series_index: number | null;
};

export const bookJson = (b: Pick<BookRow, 'id' | 'isbn13' | 'title' | 'subtitle' | 'authors' | 'publisher' | 'year' | 'pages' | 'language' | 'subjects' | 'cover'> & Partial<Pick<BookRow, 'series' | 'series_index'>>) => ({
  id: b.id, isbn13: b.isbn13, title: b.title, subtitle: b.subtitle, authors: JSON.parse(b.authors) as string[],
  publisher: b.publisher, year: b.year, pages: b.pages, language: b.language,
  subjects: JSON.parse(b.subjects ?? '[]') as string[],
  coverUrl: b.cover ? `/covers/${b.cover}` : null,
  series: b.series ?? null, seriesIndex: b.series_index ?? null
});

/** Kurzform für Listen (Regal, Startseite) */
export const bookBrief = (r: Record<string, unknown>) => ({
  id: r.bookId as number, title: r.title as string, subtitle: r.subtitle as string | null,
  authors: JSON.parse(r.authors as string) as string[], year: r.year as number | null, pages: r.pages as number | null,
  coverUrl: r.cover ? `/covers/${r.cover}` : null
});

export const getBook = (id: number) => db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow | undefined;
export const getBookByIsbn = (isbn: string) => db.prepare('SELECT * FROM books WHERE isbn13 = ?').get(isbn) as BookRow | undefined;

/** Parallele Anfragen zur gleichen ISBN (Doppelscan) nur einmal ausführen */
const pending = new Map<string, Promise<BookRow | null>>();

/** Fehlendes Cover nachladen (wartet nicht, Fehler sind egal) */
export function repairCover(bookId: number, hint: { isbn?: string; ol?: number }) {
  fetchCover(hint).then(name => {
    if (!name) return;
    if (!db.prepare('UPDATE books SET cover = ? WHERE id = ? AND cover IS NULL').run(name, bookId).changes) deleteCoverFile(name);
  }).catch(() => {});
}

export async function importIsbn(isbn: string, userId: number): Promise<BookRow | null> {
  const existing = getBookByIsbn(isbn);
  if (existing) return existing;
  if (!pending.has(isbn)) {
    pending.set(isbn, (async () => {
      const data = await lookupIsbn(isbn);
      if (!data) return null;
      return insertBook(data, await fetchCover({ isbn }), userId);
    })().finally(() => pending.delete(isbn)));
  }
  return pending.get(isbn)!;
}

function insertBook(d: BookData, cover: string | null, userId: number): BookRow {
  // INSERT OR IGNORE: ein anderer Prozess könnte die ISBN gerade parallel angelegt haben
  const r = db.prepare(`
    INSERT OR IGNORE INTO books (isbn13, title, subtitle, authors, publisher, year, pages, language, subjects, cover, source, created_by, series, series_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d.isbn13, d.title, d.subtitle, JSON.stringify(d.authors), d.publisher, d.year, d.pages, d.language,
    JSON.stringify(d.subjects), cover, d.source, userId, canonicalSeries(d.series?.name), d.series?.index ?? null);
  return r.changes ? getBook(Number(r.lastInsertRowid))! : getBookByIsbn(d.isbn13!)!;
}

// ---------- Katalog ----------

bookRoutes.post('/catalog/isbn', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const isbn = normalizeIsbn(String(b.isbn ?? ''));
  if (!isbn) throw new HTTPException(400, { message: 'Ungültige ISBN' });
  const book = await importIsbn(isbn, u.id);
  if (!book) return c.json({ found: false, isbn13: isbn }, 404);
  return c.json({ found: true, book: bookJson(book) });
});

/** Wer im Freundeskreis hat das Buch? (sichtbare Regale, ohne mich) */
const ownersOf = (bookId: number, me: number) => (db.prepare(`
  SELECT DISTINCT u.id, u.display_name AS displayName FROM copies c JOIN users u ON u.id = c.owner_id
  WHERE c.book_id = ? AND c.removed_at IS NULL AND c.owner_id != ? AND u.shelf_visible = 1 AND u.disabled = 0
  ORDER BY u.display_name LIMIT 5
`).all(bookId, me) as { id: number; displayName: string }[]);

bookRoutes.get('/catalog/search', async c => {
  const u = requireUser(c);
  const q = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (q.length < 2) return c.json([]);
  // ISBN direkt eingegeben? Dann nicht suchen, sondern nachschlagen
  const isbn = normalizeIsbn(q);
  const hits = isbn ? [] : await searchCatalog(q);
  return c.json(hits.map(h => {
    const local = h.isbn13 ? getBookByIsbn(h.isbn13) : undefined;
    // Buch im Bestand ohne Cover, die Suche kennt aber eins → im Hintergrund übernehmen
    if (local && !local.cover && h.coverHint?.ol) repairCover(local.id, { ol: h.coverHint.ol });
    return {
      isbn13: h.isbn13, title: h.title, subtitle: h.subtitle, authors: h.authors, publisher: h.publisher, year: h.year,
      bookId: local?.id ?? null,
      owners: local ? ownersOf(local.id, u.id) : [],
      coverUrl: local?.cover ? `/covers/${local.cover}`
        : h.coverHint?.ol ? `/api/catalog/cover?ol=${h.coverHint.ol}`
        : h.coverHint?.isbn ? `/api/catalog/cover?isbn=${h.coverHint.isbn}` : null
    };
  }));
});

bookRoutes.get('/catalog/cover', async c => {
  requireUser(c);
  const ol = int(c.req.query('ol'), 1, 1e10) ?? undefined;
  const isbn = c.req.query('isbn') ? normalizeIsbn(c.req.query('isbn')!) ?? undefined : undefined;
  if (!ol && !isbn) throw new HTTPException(400, { message: 'ol oder isbn fehlt' });
  const img = await previewCover({ ol, isbn });
  if (!img) return c.body(null, 404);
  c.header('Content-Type', `image/${img.ext === 'jpg' ? 'jpeg' : img.ext}`);
  c.header('Cache-Control', 'private, max-age=604800');
  return c.body(fs.readFileSync(img.file));
});

// ---------- Bücher ----------

/** Manuell erfassen (oder Suchtreffer ohne Katalogeintrag übernehmen) */
bookRoutes.post('/books', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const isbn = b.isbn ? normalizeIsbn(String(b.isbn)) : null;
  if (b.isbn && !isbn) throw new HTTPException(400, { message: 'Ungültige ISBN' });
  if (isbn) {
    const existing = getBookByIsbn(isbn);
    if (existing) return c.json(bookJson(existing));
  }
  const title = str(b.title, 300);
  if (!title) throw new HTTPException(400, { message: 'Titel fehlt' });
  const authors = Array.isArray(b.authors) ? b.authors.map(a => str(a, 120)).filter((a): a is string => !!a).slice(0, 10) : [];
  const data: BookData = {
    isbn13: isbn, title, subtitle: str(b.subtitle, 300), authors, publisher: str(b.publisher, 200),
    year: int(b.year, 0, 3000), pages: int(b.pages, 1, 100000), language: null, subjects: [], source: 'manual'
  };
  const cover = isbn ? await fetchCover({ isbn }) : null;
  return c.json(bookJson(insertBook(data, cover, u.id)));
});

bookRoutes.get('/books/:id', c => {
  const u = requireUser(c);
  const book = getBook(idParam(c));
  if (!book) throw notFound('Buch');
  // Exemplare: eigene immer, fremde nur bei sichtbarem Regal
  const copies = db.prepare(`
    SELECT c.id, c.format, c.binding, c.sprayed_edges AS sprayedEdges, c.notes, c.created_at AS createdAt,
           c.store_id AS storeId, (SELECT name FROM stores WHERE id = c.store_id) AS store,
           u.id AS ownerId, u.display_name AS ownerName, COALESCE(ub.status, 'unread') AS readStatus
    FROM copies c JOIN users u ON u.id = c.owner_id
    LEFT JOIN user_books ub ON ub.user_id = c.owner_id AND ub.book_id = c.book_id
    WHERE c.book_id = ? AND c.removed_at IS NULL AND (c.owner_id = ? OR (u.shelf_visible = 1 AND u.disabled = 0))
    ORDER BY c.owner_id = ? DESC, u.display_name
  `).all(book.id, u.id, u.id) as Array<Record<string, unknown>>;
  const reading = db.prepare('SELECT * FROM user_books WHERE user_id = ? AND book_id = ?').get(u.id, book.id) as ReadingRow | undefined;
  const archived = db.prepare(`
    SELECT id, format, binding, removed_at AS removedAt, removed_reason AS removedReason FROM copies
    WHERE book_id = ? AND owner_id = ? AND removed_at IS NOT NULL ORDER BY removed_at DESC
  `).all(book.id, u.id);
  return c.json({
    book: bookJson(book),
    canEdit: !!u.is_admin || book.created_by === u.id,
    wishlisted: !!db.prepare('SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?').get(u.id, book.id),
    reading: readingJson(reading),
    archived,
    copies: copies.map(cp => {
      const mine = cp.ownerId === u.id;
      const loan = openLoanFor(cp.id as number);
      const borrowerName = loan?.borrower_id
        ? (db.prepare('SELECT display_name AS n FROM users WHERE id = ?').get(loan.borrower_id) as { n: string } | undefined)?.n ?? null
        : loan?.borrower_remote_id
          ? (db.prepare(`SELECT ra.display_name || ' (@' || ra.username || ')' AS n FROM remote_actors ra WHERE ra.id = ?`).get(loan.borrower_remote_id) as { n: string } | undefined)?.n ?? null
          : null;
      const request = mine ? undefined : db.prepare(`SELECT id FROM loan_requests WHERE copy_id = ? AND requester_id = ? AND status = 'pending'`).get(cp.id as number, u.id) as { id: number } | undefined;
      return {
        ...cp, sprayedEdges: !!cp.sprayedEdges, mine, notes: mine ? cp.notes : null, requestId: request?.id ?? null,
        // Verleih: Verleiher sieht alles, andere nur registrierte Entleiher (keine Freitext-Namen Dritter)
        loan: !loan ? null : mine
          ? { id: loan.id, borrowerId: loan.borrower_id, borrowerName: borrowerName ?? loan.borrower_name, lentAt: loan.lent_at, dueAt: loan.due_at, note: loan.note }
          : { id: null, borrowerId: loan.borrower_id, borrowerName, lentAt: loan.lent_at, dueAt: null, note: null }
      };
    })
  });
});

bookRoutes.patch('/books/:id', async c => {
  const u = requireUser(c);
  const book = getBook(idParam(c));
  if (!book) throw notFound('Buch');
  // Katalogdaten sind geteilt: ändern darf, wer den Eintrag angelegt hat, oder ein Admin
  if (!u.is_admin && book.created_by !== u.id) throw new HTTPException(403, { message: 'Buchdaten ändern dürfen nur, wer das Buch angelegt hat, und Admins' });
  const b = await body(c);
  const title = b.title !== undefined ? str(b.title, 300) : book.title;
  if (!title) throw new HTTPException(400, { message: 'Titel fehlt' });
  const authors = Array.isArray(b.authors) ? JSON.stringify(b.authors.map(a => str(a, 120)).filter(Boolean)) : book.authors;
  db.prepare(`UPDATE books SET title = ?, subtitle = ?, authors = ?, publisher = ?, year = ?, pages = ? WHERE id = ?`).run(
    title,
    b.subtitle !== undefined ? str(b.subtitle, 300) : book.subtitle,
    authors,
    b.publisher !== undefined ? str(b.publisher, 200) : book.publisher,
    b.year !== undefined ? int(b.year, 0, 3000) : book.year,
    b.pages !== undefined ? int(b.pages, 1, 100000) : book.pages,
    book.id
  );
  return c.json(bookJson(getBook(book.id)!));
});

// ---------- Exemplare (das eigene Regal) ----------

const FORMATS = ['print', 'ebook'] as const;
const BINDINGS = ['paperback', 'hardcover'] as const;

export function shelf(ownerId: number) {
  return (db.prepare(`
    SELECT c.id, c.format, c.binding, c.sprayed_edges AS sprayedEdges, c.created_at AS createdAt, c.store_id AS storeId,
           (SELECT name FROM stores WHERE id = c.store_id) AS store,
           b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover,
           COALESCE(ub.status, 'unread') AS readStatus, ub.progress, ub.favorite,
           EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.returned_at IS NULL) AS lent
    FROM copies c JOIN books b ON b.id = c.book_id
    LEFT JOIN user_books ub ON ub.user_id = c.owner_id AND ub.book_id = c.book_id
    WHERE c.owner_id = ? AND c.removed_at IS NULL ORDER BY c.created_at DESC, c.id DESC
  `).all(ownerId) as Array<Record<string, unknown>>).map(r => ({
    id: r.id, format: r.format, binding: r.binding, sprayedEdges: !!r.sprayedEdges, readStatus: r.readStatus,
    storeId: r.storeId, store: r.store,
    progress: r.progress, favorite: !!r.favorite, createdAt: r.createdAt, lent: !!r.lent,
    book: bookBrief(r)
  }));
}

bookRoutes.get('/copies', c => {
  const u = requireUser(c);
  if (c.req.query('archived') !== '1') return c.json(shelf(u.id));
  // Archiv: entfernte Exemplare mit Grund und Datum
  return c.json((db.prepare(`
    SELECT c.id, c.format, c.binding, c.sprayed_edges AS sprayedEdges, c.created_at AS createdAt,
           c.removed_at AS removedAt, c.removed_reason AS removedReason,
           b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover
    FROM copies c JOIN books b ON b.id = c.book_id
    WHERE c.owner_id = ? AND c.removed_at IS NOT NULL ORDER BY c.removed_at DESC
  `).all(u.id) as Array<Record<string, unknown>>).map(r => ({
    id: r.id, format: r.format, binding: r.binding, sprayedEdges: !!r.sprayedEdges, createdAt: r.createdAt,
    removedAt: r.removedAt, removedReason: r.removedReason, readStatus: 'unread', progress: null, favorite: false, lent: false,
    book: bookBrief(r)
  })));
});

function ownCopy(u: User, id: number, includeArchived = false) {
  const row = db.prepare(`SELECT * FROM copies WHERE id = ? AND owner_id = ? ${includeArchived ? '' : 'AND removed_at IS NULL'}`)
    .get(id, u.id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Exemplar');
  return row;
}

const REMOVE_REASONS = ['sold', 'given_away', 'lost', 'other'] as const;

function copyFields(b: Record<string, unknown>, current?: Record<string, unknown>) {
  const format = oneOf(b.format ?? current?.format, FORMATS, 'print');
  const print = format === 'print';
  // Bindung und Farbschnitt gibt es nur bei gedruckten Büchern
  const binding = !print ? null
    : b.binding === undefined ? (current?.binding as string | null ?? null)
    : b.binding === null ? null : oneOf(b.binding, BINDINGS, 'paperback');
  const sprayed = !print ? 0 : b.sprayedEdges === undefined ? Number(current?.sprayed_edges ?? 0) : b.sprayedEdges ? 1 : 0;
  const notes = b.notes === undefined ? (current?.notes as string | null ?? null) : str(b.notes, 2000);
  // Shop/Plattform nur bei E-Books
  let storeId = print ? null : b.storeId === undefined ? (current?.store_id as number | null ?? null) : int(b.storeId, 1, Number.MAX_SAFE_INTEGER);
  if (storeId && !db.prepare('SELECT 1 FROM stores WHERE id = ?').get(storeId)) storeId = null;
  return { format, binding, sprayed, notes, storeId };
}

bookRoutes.post('/copies', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const bookId = int(b.bookId, 1, Number.MAX_SAFE_INTEGER);
  if (!bookId || !getBook(bookId)) throw notFound('Buch');
  const f = copyFields(b);
  const id = Number(db.prepare(`INSERT INTO copies (book_id, owner_id, format, binding, sprayed_edges, notes, store_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(bookId, u.id, f.format, f.binding, f.sprayed, f.notes, f.storeId).lastInsertRowid);
  // Lesestatus gleich mit setzen (gehört zur Person, nicht zum Exemplar)
  // optional mit Datum („gelesen am …“ schon beim Eintragen)
  const day = (v: unknown) => (v === '' ? null : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today() ? v : undefined);
  // gleicher Status ohne neue Daten → nichts anfassen (sonst gingen z. B. importierte Lesedaten verloren)
  const cur = db.prepare('SELECT status FROM user_books WHERE user_id = ? AND book_id = ?').get(u.id, bookId) as { status: string } | undefined;
  const same = cur?.status === b.readStatus && b.finishedAt === undefined && b.startedAt === undefined;
  if (b.readStatus !== undefined && !same) setReading(u.id, bookId, { status: oneOf(b.readStatus, READ_STATUS, 'unread'), startedAt: day(b.startedAt), finishedAt: day(b.finishedAt) });
  // jetzt im Regal → nicht mehr auf der Wunschliste
  db.prepare('DELETE FROM wishlist WHERE user_id = ? AND book_id = ?').run(u.id, bookId);
  // erstes eigenes Exemplar dieses Buchs → Freund*innen mit Wunschliste Bescheid geben
  if (!db.prepare('SELECT 1 FROM copies WHERE book_id = ? AND owner_id = ? AND id != ?').get(bookId, u.id, id)) wishAvailable(u.id, bookId);
  return c.json({ id });
});

bookRoutes.patch('/copies/:id', async c => {
  const u = requireUser(c);
  const current = ownCopy(u, idParam(c));
  const b = await body(c);
  const f = copyFields(b, current);
  db.prepare('UPDATE copies SET format = ?, binding = ?, sprayed_edges = ?, notes = ?, store_id = ? WHERE id = ?')
    .run(f.format, f.binding, f.sprayed, f.notes, f.storeId, current.id as number);
  if (b.readStatus !== undefined) setReading(u.id, current.book_id as number, { status: oneOf(b.readStatus, READ_STATUS, 'unread') });
  return c.json({ ok: true });
});

/**
 * Entfernen: mode "archive" (Standard) markiert nur – Verlauf bleibt, optional mit Grund (verkauft …);
 * mode "purge" löscht endgültig samt Verleih-Einträgen dieses Exemplars.
 */
bookRoutes.delete('/copies/:id', async c => {
  const u = requireUser(c);
  let b: Record<string, unknown> = {};
  try { b = await c.req.json(); } catch { /* ohne Body = archivieren */ }
  const mode = oneOf(b.mode, ['archive', 'purge'] as const, 'archive');
  const cp = ownCopy(u, idParam(c), mode === 'purge');
  if (db.prepare('SELECT 1 FROM loans WHERE copy_id = ? AND returned_at IS NULL').get(cp.id as number))
    throw new HTTPException(409, { message: 'Dieses Exemplar ist gerade verliehen – erst als zurückbekommen markieren' });
  if (mode === 'purge') db.prepare('DELETE FROM copies WHERE id = ?').run(cp.id as number);
  else db.prepare(`UPDATE copies SET removed_at = datetime('now'), removed_reason = ? WHERE id = ?`)
    .run(oneOf(b.reason, REMOVE_REASONS, 'other'), cp.id as number);
  return c.json({ ok: true });
});

bookRoutes.post('/copies/:id/restore', c => {
  const u = requireUser(c);
  const cp = ownCopy(u, idParam(c), true);
  db.prepare('UPDATE copies SET removed_at = NULL, removed_reason = NULL WHERE id = ?').run(cp.id as number);
  return c.json({ ok: true });
});

// ---------- E-Book-Shops ----------

bookRoutes.get('/stores', c => {
  requireUser(c);
  return c.json(db.prepare('SELECT id, name FROM stores ORDER BY name COLLATE NOCASE').all());
});

/** Neuen Shop anlegen; existiert der Name schon (Groß/klein egal), wird der vorhandene geliefert */
bookRoutes.post('/stores', async c => {
  const u = requireUser(c);
  const name = str((await body(c)).name, 60);
  if (!name) throw new HTTPException(400, { message: 'Name fehlt' });
  db.prepare('INSERT OR IGNORE INTO stores (name, created_by) VALUES (?, ?)').run(name, u.id);
  return c.json(db.prepare('SELECT id, name FROM stores WHERE name = ?').get(name));
});

// ---------- Reihen ----------

/**
 * Vorhandene Schreibweise einer Reihe wiederverwenden („WÄCHTER“ → „Wächter“). SQLite-NOCASE faltet nur ASCII,
 * deshalb wird in JS verglichen; die Zahl verschiedener Reihen ist klein.
 */
export function canonicalSeries(name: string | null | undefined): string | null {
  const n = name?.trim();
  if (!n) return null;
  const key = n.toLocaleLowerCase('de');
  const found = (db.prepare('SELECT DISTINCT series FROM books WHERE series IS NOT NULL').all() as { series: string }[])
    .find(r => r.series.toLocaleLowerCase('de') === key);
  return found?.series ?? n;
}

/** Reihe/Band von Hand setzen oder korrigieren (geteilte Katalogdaten, die Erkennung ist nicht perfekt – darf jede Person) */
bookRoutes.put('/books/:id/series', async c => {
  requireUser(c);
  const book = getBook(idParam(c));
  if (!book) throw notFound('Buch');
  const b = await body(c);
  const name = canonicalSeries(str(b.name, 200));
  const raw = b.index === '' || b.index == null ? null : Number(String(b.index).replace(',', '.'));
  if (raw != null && (!Number.isFinite(raw) || raw < 0 || raw > 1000)) throw new HTTPException(400, { message: 'Ungültige Bandnummer' });
  db.prepare('UPDATE books SET series = ?, series_index = ? WHERE id = ?').run(name, name ? raw : null, book.id);
  return c.json(bookJson(getBook(book.id)!));
});

type SeriesBook = { bookId: number; title: string; subtitle: string | null; authors: string; year: number | null; pages: number | null; cover: string | null; series_index: number | null; status: string | null; owned: number; friends: number };

/** Alle Bände einer Reihe in der Instanz, mit eigenem Lesestand und ob man/Freund*innen es besitzen */
export function seriesBooks(name: string, userId: number) {
  return (db.prepare(`
    SELECT b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover, b.series_index, ub.status,
           EXISTS (SELECT 1 FROM copies c WHERE c.book_id = b.id AND c.owner_id = :u AND c.removed_at IS NULL) AS owned,
           (SELECT COUNT(DISTINCT c.owner_id) FROM copies c JOIN users o ON o.id = c.owner_id
             WHERE c.book_id = b.id AND c.owner_id != :u AND c.removed_at IS NULL AND o.shelf_visible = 1 AND o.disabled = 0) AS friends
    FROM books b LEFT JOIN user_books ub ON ub.book_id = b.id AND ub.user_id = :u
    WHERE b.series = :s
    ORDER BY b.series_index IS NULL, b.series_index, b.year, b.title
  `).all({ u: userId, s: name }) as SeriesBook[]).map(r => ({
    ...bookBrief(r), index: r.series_index, status: (r.status ?? 'unread') as string, owned: !!r.owned, friends: r.friends
  }));
}

bookRoutes.get('/series', c => {
  const u = requireUser(c);
  const name = canonicalSeries(c.req.query('name'));
  if (!name) throw new HTTPException(400, { message: 'Reihe fehlt' });
  const books = seriesBooks(name, u.id);
  // nächster Band: erster ungelesene nach dem höchsten gelesenen
  const lastRead = Math.max(-1, ...books.map((b, i) => (b.status === 'read' ? i : -1)));
  const next = books.slice(lastRead + 1).find(b => b.status !== 'read' && b.status !== 'dnf') ?? null;
  return c.json({ name, books, next });
});

/** Meine Reihen: alle Reihen, von denen ich etwas besitze oder gelesen/angefangen habe */
bookRoutes.get('/me/series', c => {
  const u = requireUser(c);
  const names = (db.prepare(`
    SELECT DISTINCT b.series AS name FROM books b
    WHERE b.series IS NOT NULL AND (
      EXISTS (SELECT 1 FROM copies c WHERE c.book_id = b.id AND c.owner_id = :u AND c.removed_at IS NULL)
      OR EXISTS (SELECT 1 FROM user_books ub WHERE ub.book_id = b.id AND ub.user_id = :u AND ub.status != 'unread'))
    ORDER BY b.series COLLATE NOCASE
  `).all({ u: u.id }) as { name: string }[]).map(r => r.name);
  return c.json(names.map(name => {
    const books = seriesBooks(name, u.id);
    const lastRead = Math.max(-1, ...books.map((b, i) => (b.status === 'read' ? i : -1)));
    return {
      name, total: books.length, read: books.filter(b => b.status === 'read').length, owned: books.filter(b => b.owned).length,
      next: books.slice(lastRead + 1).find(b => b.status !== 'read' && b.status !== 'dnf') ?? null,
      covers: books.slice(0, 6).map(b => ({ id: b.id, title: b.title, coverUrl: b.coverUrl, status: b.status }))
    };
  }));
});
