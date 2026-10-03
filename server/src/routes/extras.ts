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
import { selfUrl } from '../federation.ts';

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
  favorite?: boolean; wishlist?: boolean; dateUnknown?: boolean; policy?: string;
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
  kickImports();
  const rows = db.prepare('SELECT * FROM imports WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(u.id) as ImportRow[];
  return c.json(rows.map(r => ({ ...jobJson(r, false), changes: journal.summary(r.id) })));
});

// ---------- Import als Hintergrund-Job ----------
// Die App lädt die ganze Datei auf einmal hoch; der Server arbeitet sie in Paketen ab (Katalogabfragen dauern).
// Fortschritt, Fehlschläge und Konflikte stehen in der Zeile – die App darf geschlossen werden.
// Startet der Prozess neu (Passenger legt untätige Apps schlafen), geht es beim nächsten Start weiter.

type ImportRow = {
  id: number; user_id: number; source: string; filename: string | null; total: number; created_at: string; undone_at: string | null;
  status: string; options: string | null; queue: string | null; done: number; results: string | null; finished_at: string | null;
};
type JobConflict = { item: ImportItem; title: string; bookId?: number; field: string; mine: unknown; theirs: unknown };
type JobResults = { ok: number; exists: number; failed: string[]; conflicts: JobConflict[] };
const emptyResults = (): JobResults => ({ ok: 0, exists: 0, failed: [], conflicts: [] });
const parseResults = (r: ImportRow): JobResults => { try { return { ...emptyResults(), ...JSON.parse(r.results ?? '{}') }; } catch { return emptyResults(); } };

function jobJson(r: ImportRow, withConflicts = true) {
  const res = parseResults(r);
  return {
    id: r.id, source: r.source, filename: r.filename, total: r.total, createdAt: r.created_at, undoneAt: r.undone_at,
    status: r.status, done: r.done, finishedAt: r.finished_at,
    ok: res.ok, exists: res.exists, failed: res.failed, conflictCount: res.conflicts.length,
    ...(withConflicts ? { conflicts: res.conflicts } : {})
  };
}
const ownJob = (id: number, userId: number) => {
  const r = db.prepare('SELECT * FROM imports WHERE id = ? AND user_id = ?').get(id, userId) as ImportRow | undefined;
  if (!r) throw notFound('Import');
  return r;
};

extraRoutes.post('/imports/jobs', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const items = Array.isArray(b.items) ? (b.items as ImportItem[]).filter(x => x && typeof x === 'object').slice(0, 20000) : [];
  if (!items.length) throw new HTTPException(400, { message: 'Keine Einträge zum Importieren' });
  if (db.prepare("SELECT 1 FROM imports WHERE user_id = ? AND status = 'running'").get(u.id))
    throw new HTTPException(409, { message: 'Es läuft schon ein Import – bitte warte, bis er fertig ist' });
  const r = db.prepare(`INSERT INTO imports (user_id, source, filename, total, status, options, queue, results) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`)
    .run(u.id, str(b.source, 40) ?? 'csv', str(b.filename, 200), items.length, JSON.stringify(b.options ?? {}), JSON.stringify(items), JSON.stringify(emptyResults()));
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
  if (host) seenUrl = `${c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '')}://${host}`;
  kickImports();
  return c.json({ id: Number(r.lastInsertRowid) });
});

extraRoutes.get('/imports/:id', c => {
  const u = requireUser(c);
  kickImports();
  return c.json(jobJson(ownJob(idParam(c), u.id)));
});

extraRoutes.post('/imports/:id/cancel', c => {
  const u = requireUser(c);
  const r = ownJob(idParam(c), u.id);
  if (r.status === 'running') db.prepare("UPDATE imports SET status = 'cancelled', queue = NULL, finished_at = datetime('now') WHERE id = ?").run(r.id);
  return c.json(jobJson(ownJob(r.id, u.id)));
});

/** Entscheidungen zu Konflikten: Einträge mit „Import übernehmen“ laufen noch einmal durch, der Rest bleibt wie er ist */
extraRoutes.post('/imports/:id/resolve', async c => {
  const u = requireUser(c);
  const r = ownJob(idParam(c), u.id);
  if (r.status === 'running') throw new HTTPException(409, { message: 'Der Import läuft noch' });
  if (r.undone_at) throw new HTTPException(409, { message: 'Dieser Import wurde schon rückgängig gemacht' });
  const b = await body(c);
  const picks = Array.isArray(b.theirs) ? b.theirs.filter((i): i is number => Number.isInteger(i)) : [];
  const res = parseResults(r);
  const byItem = new Map<string, ImportItem & { resolve: string[] }>();
  for (const i of picks) {
    const cf = res.conflicts[i];
    if (!cf) continue;
    const key = JSON.stringify(cf.item);
    const it = byItem.get(key) ?? { ...cf.item, resolve: [], policy: 'mine' };
    it.resolve.push(cf.field);
    byItem.set(key, it);
  }
  res.conflicts = [];
  const queue = [...byItem.values()];
  db.prepare(`UPDATE imports SET results = ?, queue = ?, status = ?, finished_at = ? WHERE id = ?`)
    .run(JSON.stringify(res), JSON.stringify(queue), queue.length ? 'running' : 'done', queue.length ? null : r.finished_at, r.id);
  kickImports();
  return c.json(jobJson(ownJob(r.id, u.id)));
});

let working = false;
/**
 * Passenger (Plesk) legt Apps ohne Anfragen nach ein paar Minuten schlafen – dann stünde der Import still,
 * bis jemand die Seite öffnet. Solange ein Import läuft, ruft sich der Server deshalb jede Minute selbst auf.
 */
let seenUrl: string | null = null;
let lastPing = 0;
function keepAlive() {
  const url = selfUrl() ?? seenUrl;
  if (!url || Date.now() - lastPing < 60_000) return;
  lastPing = Date.now();
  fetch(`${url}/api/status`, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
}
/** Worker anstoßen (idempotent): beim Start, bei neuen Jobs und bei Abfragen des Fortschritts */
export function kickImports() {
  if (!working) void work();
}
async function work() {
  working = true;
  try {
    for (;;) {
      const job = db.prepare("SELECT * FROM imports WHERE status = 'running' ORDER BY id LIMIT 1").get() as ImportRow | undefined;
      if (!job) break;
      const queue = JSON.parse(job.queue ?? '[]') as ImportItem[];
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(job.user_id) as User | undefined;
      if (!queue.length || !user) {
        db.prepare("UPDATE imports SET status = 'done', queue = NULL, finished_at = datetime('now') WHERE id = ?").run(job.id);
        continue;
      }
      keepAlive();
      const batch = queue.slice(0, 8);
      let out: ImportResult[];
      try { out = await importItems(user, batch, JSON.parse(job.options ?? '{}'), job.id); }
      catch { out = batch.map(it => ({ title: it.title ?? it.isbn ?? '?', result: 'failed' as const })); }
      // inzwischen abgebrochen oder rückgängig gemacht? Dann nichts mehr eintragen
      const now = db.prepare('SELECT status, results FROM imports WHERE id = ?').get(job.id) as { status: string; results: string | null } | undefined;
      if (!now || now.status !== 'running') continue;
      const res = parseResults({ ...job, results: now.results });
      out.forEach((r, j) => {
        if (r.result === 'ok') res.ok++;
        else if (r.result === 'exists') res.exists++;
        else if (r.result === 'failed') res.failed.push(r.title);
        else { res.ok++; for (const cf of r.conflicts ?? []) res.conflicts.push({ item: batch[j], title: r.title, bookId: r.bookId, ...cf }); }
      });
      const rest = queue.slice(batch.length);
      // fertig → Glocke (die App ist dann womöglich längst zu); nicht nach Entscheidungen zu Konflikten
      if (!rest.length && !batch.some(it => it.policy))
        db.prepare("INSERT INTO notifications (user_id, type, actor_label, ref_id) VALUES (?, 'import_done', ?, ?)").run(job.user_id, job.filename ?? job.source, job.id);
      db.prepare(`UPDATE imports SET queue = ?, done = MIN(total, done + ?), results = ?, status = ?, finished_at = ? WHERE id = ?`)
        .run(rest.length ? JSON.stringify(rest) : null, batch.filter(it => !it.policy).length, JSON.stringify(res),
          rest.length ? 'running' : 'done', rest.length ? null : new Date().toISOString().slice(0, 19).replace('T', ' '), job.id);
      // föderierte Reviews etc. am Ende nicht nötig – importItems verteilt sie selbst
      await new Promise(r => setImmediate(r));
    }
  } finally {
    working = false;
  }
}

extraRoutes.post('/imports/:id/undo', c => {
  const u = requireUser(c);
  const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND user_id = ?').get(idParam(c), u.id) as { id: number; undone_at: string | null } | undefined;
  if (!imp) throw notFound('Import');
  if (imp.undone_at) throw new HTTPException(409, { message: 'Dieser Import wurde schon rückgängig gemacht' });
  // läuft er noch: erst anhalten, dann zurückspielen
  db.prepare("UPDATE imports SET status = 'cancelled', queue = NULL WHERE id = ? AND status = 'running'").run(imp.id);
  const r = journal.undo(imp.id);
  // föderierte Reviews auf den anderen Instanzen nachziehen
  for (const rb of r.reviewBooks) federate(rb.bookId, rb.userId, rb.prevId);
  return c.json({ reverted: r.reverted, skipped: r.skipped });
});

type ImportOptions = Record<string, unknown>;
type ImportResult = { title: string; bookId?: number; result: 'ok' | 'exists' | 'failed' | 'conflict'; done?: string[];
  conflicts?: Array<{ field: 'status' | 'finishedAt' | 'rating' | 'review'; mine: unknown; theirs: unknown }> };

/** Ein Paket (max. 10) Einträge direkt importieren – für ältere Clients; die App nutzt den Hintergrund-Job (/imports/jobs) */
extraRoutes.post('/import', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const items = Array.isArray(b.items) ? (b.items as ImportItem[]).slice(0, 10) : [];
  // Journal: ohne importId wird nichts aufgezeichnet (ältere Clients) – dann ist kein Rückgängig möglich
  const imp = int(b.importId, 1, Number.MAX_SAFE_INTEGER);
  if (imp && !db.prepare('SELECT 1 FROM imports WHERE id = ? AND user_id = ? AND undone_at IS NULL').get(imp, u.id)) throw notFound('Import');
  return c.json({ results: await importItems(u, items, (b.options ?? {}) as ImportOptions, imp) });
});

/** Einträge importieren; Optionen bestimmen, was entsteht. it.policy (vom Job bei Entscheidungen gesetzt) überstimmt die Regel */
async function importItems(u: User, items: ImportItem[], o: ImportOptions, imp: number | null): Promise<ImportResult[]> {
  const copies = oneOf(o.copies, ['owned', 'all', 'none'] as const, 'owned');
  const visibility = oneOf(o.visibility, ['private', 'instance', 'federated'] as const, 'instance');
  // Unterschiede zum Bestand: ask = melden, mine = bookshelv behalten, theirs = Import übernehmen
  const basePolicy = oneOf(o.conflict, ['ask', 'mine', 'theirs'] as const, 'mine');
  const results: ImportResult[] = [];
  for (const it of items) {
    const policy = it.policy === 'mine' || it.policy === 'theirs' ? it.policy : basePolicy;
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
  return results;
}
