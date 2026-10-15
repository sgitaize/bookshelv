/**
 * Lokale App-Bibliothek mit einem Konto zusammenführen (Stufe 3 der Apps).
 *
 * Die App exportiert ihre Bibliothek (GET /api/me/export.json) als Import-Einträge im gewohnten Format
 * plus `app`-Teil mit allem, was die CSV-Formate nicht kennen: alle Exemplare samt Verleih, Fortschritt,
 * Stimmungen/Tempo, Top 5, Sprache, Reihe, eigene Cover. Der Server spielt das als normalen Import-Job ein
 * (Quelle „bookshelv-app“) – also mit Abgleich, Konflikt-Rückfragen und „Rückgängig“.
 *
 * Grundsatz beim Zusammenführen: Lücken füllen, nie etwas Vorhandenes überschreiben
 * (echte Unterschiede bei Lesestand/Bewertung laufen über die normalen Konfliktregeln des Imports).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from './db.ts';
import { config } from './config.ts';
import * as journal from './journal.ts';
import { imageType } from './routes/social.ts';
import { canonicalSeries, type BookRow } from './routes/books.ts';
import { MOODS, PACES } from './routes/reviews.ts';

type ListRef = { name: string; createdAt?: string | null; addedAt?: string | null; description?: string | null };
export type AppLoan = { borrower: string | null; lentAt: string; dueAt: string | null; returnedAt: string | null; note: string | null };
export type AppCopy = {
  format: string; binding: string | null; sprayedEdges: boolean; notes: string | null; store: string | null; addedAt: string;
  durationMin: number | null; unsure: boolean; removedAt: string | null; removedReason: string | null; loans: AppLoan[];
};
export type AppExtras = {
  subtitle?: string | null; publisher?: string | null; year?: number | null; pages?: number | null;
  series?: string | null; seriesIndex?: number | null; language?: string | null;
  progress?: number | null; topRank?: number | null; moods?: string[]; pace?: string | null;
  wishNote?: string | null; copies?: AppCopy[]; cover?: string | null;
};

const day = (v: string | null) => (v ? v.slice(0, 10) : null);

/** Vollständiger Export der eigenen Bibliothek für die Übernahme in ein Konto */
export function appExport(userId: number) {
  const books = db.prepare(`
    SELECT DISTINCT b.* FROM books b WHERE
      EXISTS (SELECT 1 FROM copies WHERE book_id = b.id AND owner_id = :u)
      OR EXISTS (SELECT 1 FROM user_books WHERE book_id = b.id AND user_id = :u AND (status != 'unread' OR favorite = 1 OR top_rank IS NOT NULL))
      OR EXISTS (SELECT 1 FROM reviews WHERE book_id = b.id AND user_id = :u)
      OR EXISTS (SELECT 1 FROM wishlist WHERE book_id = b.id AND user_id = :u)
      OR EXISTS (SELECT 1 FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.book_id = b.id AND l.user_id = :u)
    ORDER BY b.id
  `).all({ u: userId }) as BookRow[];

  const items = books.map(b => {
    const ub = db.prepare('SELECT * FROM user_books WHERE user_id = ? AND book_id = ?').get(userId, b.id) as
      { status: string; progress: number | null; started_at: string | null; finished_at: string | null; favorite: number; top_rank: number | null } | undefined;
    const rv = db.prepare('SELECT * FROM reviews WHERE user_id = ? AND book_id = ?').get(userId, b.id) as
      { rating: number | null; text: string | null; spoiler: number; moods: string; pace: string | null } | undefined;
    const wish = db.prepare('SELECT note FROM wishlist WHERE user_id = ? AND book_id = ?').get(userId, b.id) as { note: string | null } | undefined;
    const lang = db.prepare('SELECT language FROM user_book_lang WHERE user_id = ? AND book_id = ?').get(userId, b.id) as { language: string } | undefined;
    const lists = db.prepare(`SELECT l.name, l.description, l.created_at AS createdAt, li.added_at AS addedAt
      FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.book_id = ? AND l.user_id = ? ORDER BY li.position`).all(b.id, userId) as ListRef[];
    const copies = (db.prepare(`SELECT c.*, s.name AS store FROM copies c LEFT JOIN stores s ON s.id = c.store_id
      WHERE c.book_id = ? AND c.owner_id = ? ORDER BY c.id`).all(b.id, userId) as Record<string, string | number | null>[]).map(c => ({
      format: String(c.format), binding: c.binding as string | null, sprayedEdges: !!c.sprayed_edges, notes: c.notes as string | null,
      store: c.store as string | null, addedAt: String(c.created_at), durationMin: c.duration_min as number | null, unsure: !!c.owner_unsure,
      removedAt: c.removed_at as string | null, removedReason: c.removed_reason as string | null,
      loans: (db.prepare('SELECT * FROM loans WHERE copy_id = ? ORDER BY id').all(c.id) as Record<string, string | null>[]).map(l => ({
        borrower: l.borrower_name, lentAt: String(l.lent_at), dueAt: l.due_at, returnedAt: l.returned_at, note: l.note
      }))
    }));
    // eigene Cover (hochgeladen oder ohne ISBN) mitschicken – Katalog-Cover holt sich der Server selbst
    let cover: string | null = null;
    if (b.cover && (b.cover.includes('-own-') || !b.isbn13)) {
      try {
        const buf = fs.readFileSync(path.join(config.dataDir, 'covers', b.cover));
        const type = imageType(buf);
        if (type && buf.length <= 1.5 * 1024 * 1024) cover = `data:image/${type};base64,${buf.toString('base64')}`;
      } catch { /* Datei fehlt */ }
    }
    const status = ub?.status ?? 'unread';
    return {
      isbn: b.isbn13 ?? undefined, title: b.title, authors: JSON.parse(b.authors) as string[],
      status, startedAt: day(ub?.started_at ?? null), finishedAt: day(ub?.finished_at ?? null), favorite: !!ub?.favorite,
      rating: rv?.rating ?? null, review: rv?.text ?? null, spoiler: !!rv?.spoiler,
      wishlist: !!wish, owned: false, lists,
      addedAt: day(copies[0]?.addedAt ?? null),
      app: {
        subtitle: b.subtitle, publisher: b.publisher, year: b.year, pages: b.pages,
        series: b.series, seriesIndex: b.series_index, language: lang?.language ?? null,
        progress: ub?.progress ?? null, topRank: ub?.top_rank ?? null,
        moods: rv ? JSON.parse(rv.moods || '[]') as string[] : [], pace: rv?.pace ?? null,
        wishNote: wish?.note ?? null, copies, cover
      } satisfies AppExtras
    };
  });
  const follows = (db.prepare('SELECT author FROM author_follows WHERE user_id = ?').all(userId) as { author: string }[]).map(r => r.author);
  return { format: 'bookshelv-app', version: 1, exportedAt: new Date().toISOString(), items, follows };
}

const isStamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function storeId(name: string | null, userId: number): number | null {
  if (!name) return null;
  const hit = db.prepare('SELECT id FROM stores WHERE name = ?').get(name) as { id: number } | undefined;
  if (hit) return hit.id;
  return Number(db.prepare('INSERT INTO stores (name, created_by) VALUES (?, ?)').run(name.slice(0, 60), userId).lastInsertRowid);
}

/** `app`-Teil eines Import-Eintrags anwenden (nach dem normalen Abgleich von Lesestand, Bewertung, Listen) */
export function applyAppExtras(userId: number, book: BookRow, x: AppExtras, imp: number | null): string[] {
  const done: string[] = [];
  const ub = { user_id: userId, book_id: book.id };

  // Katalogangaben nur ergänzen (z. B. von Hand angelegte Bücher ohne Katalogtreffer)
  const cur = db.prepare("SELECT * FROM books WHERE id = ?").get(book.id) as BookRow;
  const fill: Record<string, unknown> = {};
  if (!cur.subtitle && text(x.subtitle, 300)) fill.subtitle = text(x.subtitle, 300);
  if (!cur.publisher && text(x.publisher, 200)) fill.publisher = text(x.publisher, 200);
  if (!cur.year && Number.isInteger(x.year)) fill.year = x.year;
  if (!cur.pages && Number.isInteger(x.pages) && x.pages! > 0) fill.pages = x.pages;
  if (!cur.series && text(x.series, 200)) { fill.series = canonicalSeries(text(x.series, 200)); fill.series_index = typeof x.seriesIndex === 'number' ? x.seriesIndex : null; }
  if (Object.keys(fill).length) {
    journal.before(imp, 'books', { id: book.id });
    db.prepare(`UPDATE books SET ${Object.keys(fill).map(k => `${k} = :${k}`).join(', ')} WHERE id = :id`).run({ ...fill, id: book.id } as Record<string, string | number | null>);
    done.push('book');
  }
  if (!cur.cover && typeof x.cover === 'string') {
    const m = x.cover.match(/^data:image\/(webp|jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/);
    const buf = m ? Buffer.from(m[2], 'base64') : null;
    const type = buf ? imageType(buf) : null;
    if (buf && type && buf.length <= 1.5 * 1024 * 1024) {
      const name = `${cur.isbn13 ?? 'b' + cur.id}-own-${crypto.randomBytes(4).toString('hex')}.${type}`;
      fs.writeFileSync(path.join(config.dataDir, 'covers', name), buf);
      journal.before(imp, 'books', { id: book.id });
      db.prepare('UPDATE books SET cover = ? WHERE id = ? AND cover IS NULL').run(name, book.id);
      done.push('cover');
    }
  }

  // Exemplare: gleiche Form (Druck/E-Book/Hörbuch) zählt als dasselbe Exemplar → nur Lücken füllen; sonst neu anlegen
  const used = new Set<number>();
  for (const c of Array.isArray(x.copies) ? x.copies.slice(0, 20) : []) {
    const format = c.format === 'ebook' || c.format === 'audio' ? c.format : 'print';
    const binding = format === 'print' && (c.binding === 'paperback' || c.binding === 'hardcover') ? c.binding : null;
    const store = storeId(text(c.store, 60), userId);
    const removed = isStamp(c.removedAt) ? c.removedAt : null;
    const reason = ['sold', 'given_away', 'lost', 'other'].includes(c.removedReason ?? '') ? c.removedReason : null;
    const match = db.prepare(`SELECT * FROM copies WHERE book_id = ? AND owner_id = ? AND format = ? AND
      ${removed ? 'removed_at = ?' : 'removed_at IS NULL'} ORDER BY id`).all(...[book.id, userId, format, ...(removed ? [removed] : [])])
      .find(r => !used.has((r as { id: number }).id)) as Record<string, string | number | null> | undefined;
    let copyId: number;
    if (match) {
      copyId = Number(match.id);
      const patch: Record<string, string | number | null> = {};
      if (!match.binding && binding) patch.binding = binding;
      if (!match.sprayed_edges && c.sprayedEdges) patch.sprayed_edges = 1;
      if (!match.notes && text(c.notes, 1000)) patch.notes = text(c.notes, 1000);
      if (!match.store_id && store) patch.store_id = store;
      if (!match.duration_min && Number.isInteger(c.durationMin)) patch.duration_min = c.durationMin;
      if (Object.keys(patch).length) {
        journal.before(imp, 'copies', { id: copyId });
        db.prepare(`UPDATE copies SET ${Object.keys(patch).map(k => `${k} = :${k}`).join(', ')} WHERE id = :id`).run({ ...patch, id: copyId });
        done.push('copy');
      }
    } else {
      const added = isStamp(c.addedAt) ? c.addedAt : null;
      copyId = Number(db.prepare(`INSERT INTO copies (book_id, owner_id, format, binding, sprayed_edges, notes, store_id, duration_min, owner_unsure,
          removed_at, removed_reason, created_at, quiet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`)
        .run(book.id, userId, format, binding, c.sprayedEdges ? 1 : 0, text(c.notes, 1000), store,
          Number.isInteger(c.durationMin) ? c.durationMin : null, c.unsure ? 1 : 0, removed, removed ? reason : null, added, added ? 0 : 1).lastInsertRowid);
      journal.created(imp, 'copies', { id: copyId });
      done.push('copy');
      // im Regal → nicht mehr auf der Wunschliste (wie beim Anlegen von Hand)
      if (!removed && db.prepare('SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ?').get(userId, book.id)) {
        journal.before(imp, 'wishlist', ub);
        db.prepare('DELETE FROM wishlist WHERE user_id = ? AND book_id = ?').run(userId, book.id);
      }
    }
    used.add(copyId);
    // Verleih (lokal nur an Namen) – gleicher Tag + gleicher Name gibt es schon → überspringen
    for (const l of Array.isArray(c.loans) ? c.loans.slice(0, 100) : []) {
      if (!isDay(l.lentAt?.slice(0, 10))) continue;
      const lent = l.lentAt.slice(0, 10);
      const who = text(l.borrower, 100);
      if (db.prepare('SELECT 1 FROM loans WHERE copy_id = ? AND lent_at = ? AND borrower_name IS ?').get(copyId, lent, who)) continue;
      const returned = isDay(l.returnedAt?.slice(0, 10)) ? l.returnedAt!.slice(0, 10) : null;
      // offen verliehen nur, wenn das Exemplar nicht schon anderweitig verliehen ist
      if (!returned && db.prepare('SELECT 1 FROM loans WHERE copy_id = ? AND returned_at IS NULL').get(copyId)) continue;
      const id = Number(db.prepare('INSERT INTO loans (copy_id, lender_id, borrower_name, lent_at, due_at, returned_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(copyId, userId, who, lent, isDay(l.dueAt) ? l.dueAt : null, returned, text(l.note, 500)).lastInsertRowid);
      journal.created(imp, 'loans', { id });
      done.push('loan');
    }
  }

  // Lesestand: Fortschritt und Top 5 nur ergänzen
  const reading = db.prepare('SELECT status, progress, top_rank FROM user_books WHERE user_id = ? AND book_id = ?').get(userId, book.id) as
    { status: string; progress: number | null; top_rank: number | null } | undefined;
  if (reading && reading.status === 'reading' && reading.progress === null && Number.isInteger(x.progress) && x.progress! > 0) {
    journal.before(imp, 'user_books', ub);
    db.prepare('UPDATE user_books SET progress = ? WHERE user_id = ? AND book_id = ?').run(x.progress as number, userId, book.id);
    done.push('progress');
  }
  if (Number.isInteger(x.topRank) && x.topRank! >= 1 && x.topRank! <= 5 && !reading?.top_rank
    && !db.prepare('SELECT 1 FROM user_books WHERE user_id = ? AND top_rank = ?').get(userId, x.topRank as number)) {
    journal.before(imp, 'user_books', ub);
    db.prepare(`INSERT INTO user_books (user_id, book_id, top_rank) VALUES (?, ?, ?)
      ON CONFLICT (user_id, book_id) DO UPDATE SET top_rank = excluded.top_rank`).run(userId, book.id, x.topRank as number);
    done.push('top');
  }

  // Stimmungen/Tempo an der (jetzt vorhandenen) Bewertung ergänzen
  const rv = db.prepare('SELECT id, moods, pace FROM reviews WHERE user_id = ? AND book_id = ?').get(userId, book.id) as { id: number; moods: string; pace: string | null } | undefined;
  const moods = (Array.isArray(x.moods) ? x.moods : []).filter(m => MOODS.includes(m));
  const pace = x.pace && PACES.includes(x.pace) ? x.pace : null;
  if (rv && ((moods.length && rv.moods === '[]') || (pace && !rv.pace))) {
    journal.before(imp, 'reviews', { id: rv.id });
    db.prepare('UPDATE reviews SET moods = ?, pace = ? WHERE id = ?').run(rv.moods === '[]' && moods.length ? JSON.stringify(moods) : rv.moods, rv.pace ?? pace, rv.id);
    done.push('review');
  }

  // Sprache je Buch, Notiz auf der Wunschliste
  const lang = text(x.language, 12);
  if (lang && !db.prepare('SELECT 1 FROM user_book_lang WHERE user_id = ? AND book_id = ?').get(userId, book.id)) {
    db.prepare('INSERT INTO user_book_lang (user_id, book_id, language) VALUES (?, ?, ?)').run(userId, book.id, lang);
    journal.created(imp, 'user_book_lang', ub);
  }
  const note = text(x.wishNote, 300);
  if (note && db.prepare('SELECT 1 FROM wishlist WHERE user_id = ? AND book_id = ? AND note IS NULL').get(userId, book.id)) {
    journal.before(imp, 'wishlist', ub);
    db.prepare('UPDATE wishlist SET note = ? WHERE user_id = ? AND book_id = ?').run(note, userId, book.id);
  }
  return done;
}

/** Gefolgte Autor*innen übernehmen (einmal je Job, beim Anlegen) */
export function applyFollows(userId: number, authors: unknown, imp: number) {
  if (!Array.isArray(authors)) return;
  for (const a of authors.slice(0, 500)) {
    const name = text(a, 200);
    if (name && db.prepare('INSERT OR IGNORE INTO author_follows (user_id, author) VALUES (?, ?)').run(userId, name).changes)
      journal.created(imp, 'author_follows', { user_id: userId, author: name });
  }
}
