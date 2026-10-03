/**
 * Import-Journal: Vor jeder Änderung durch einen Import wird der bisherige Zustand der Zeile gemerkt
 * (nur beim ersten Mal je Import). Rückgängig spielt die Einträge rückwärts ab: neue Zeilen löschen,
 * geänderte wiederherstellen. Bücher im Katalog werden nur gelöscht, wenn niemand sonst sie nutzt.
 */
import { db, tx } from './db.ts';
import { deleteCoverFile } from './catalog.ts';

// Tabellen und ihre Schlüsselspalten – nur diese darf das Journal anfassen
const KEYS = {
  books: ['id'],
  copies: ['id'],
  user_books: ['user_id', 'book_id'],
  reviews: ['id'],
  wishlist: ['user_id', 'book_id'],
  lists: ['id'],
  list_items: ['list_id', 'book_id']
} as const;
export type Tbl = keyof typeof KEYS;
type Key = Record<string, number>;

const where = (tbl: Tbl) => KEYS[tbl].map(k => `${k} = :${k}`).join(' AND ');
const keyOf = (tbl: Tbl, key: Key) => JSON.stringify(Object.fromEntries(KEYS[tbl].map(k => [k, key[k]])));

/** Zustand vor einer Änderung merken (bestehende Zeile) – vor UPDATE/DELETE aufrufen */
export function before(importId: number | null, tbl: Tbl, key: Key) {
  if (!importId) return;
  const row = db.prepare(`SELECT * FROM ${tbl} WHERE ${where(tbl)}`).get(key);
  db.prepare('INSERT OR IGNORE INTO import_changes (import_id, tbl, key, before) VALUES (?, ?, ?, ?)')
    .run(importId, tbl, keyOf(tbl, key), row ? JSON.stringify(row) : null);
}

/** Neu angelegte Zeile merken – nach dem INSERT aufrufen */
export function created(importId: number | null, tbl: Tbl, key: Key) {
  if (!importId) return;
  db.prepare('INSERT OR IGNORE INTO import_changes (import_id, tbl, key, before) VALUES (?, ?, ?, NULL)').run(importId, tbl, keyOf(tbl, key));
}

/** Zusammenfassung je Import: was wurde neu angelegt, was geändert */
export function summary(importId: number) {
  const rows = db.prepare(`SELECT tbl, before IS NULL AS isNew, COUNT(*) AS n FROM import_changes WHERE import_id = ? GROUP BY tbl, isNew`).all(importId) as { tbl: Tbl; isNew: number; n: number }[];
  const out: Record<string, { added: number; changed: number }> = {};
  for (const r of rows) {
    out[r.tbl] ??= { added: 0, changed: 0 };
    out[r.tbl][r.isNew ? 'added' : 'changed'] += r.n;
  }
  return out;
}

/** Import rückgängig machen; gibt zurück, was übersprungen werden musste (z. B. inzwischen verliehene Exemplare) */
export function undo(importId: number): { reverted: number; skipped: number; reviewBooks: Array<{ bookId: number; userId: number; prevId: number | null }> } {
  const changes = db.prepare('SELECT * FROM import_changes WHERE import_id = ? ORDER BY id DESC').all(importId) as
    { id: number; tbl: Tbl; key: string; before: string | null }[];
  let reverted = 0, skipped = 0;
  const reviewBooks: Array<{ bookId: number; userId: number; prevId: number | null }> = [];
  const books: number[] = [];
  tx(() => {
    for (const ch of changes) {
      if (!(ch.tbl in KEYS)) continue;
      const key = JSON.parse(ch.key) as Key;
      if (ch.tbl === 'books') { if (!ch.before) books.push(key.id); continue; } // am Ende, wenn nichts mehr darauf zeigt
      const cur = db.prepare(`SELECT * FROM ${ch.tbl} WHERE ${where(ch.tbl)}`).get(key) as Record<string, unknown> | undefined;
      if (ch.tbl === 'copies' && db.prepare('SELECT 1 FROM loans WHERE copy_id = ?').get(key.id)) { skipped++; continue; } // Verleih-Historie nicht zerstören
      if (ch.tbl === 'reviews') {
        const r = (ch.before ? JSON.parse(ch.before) : cur) as { book_id: number; user_id: number; visibility: string } | undefined;
        if (r) reviewBooks.push({ bookId: r.book_id, userId: r.user_id, prevId: cur && (cur as { visibility: string }).visibility === 'federated' ? key.id : null });
      }
      if (!ch.before) {
        if (cur) db.prepare(`DELETE FROM ${ch.tbl} WHERE ${where(ch.tbl)}`).run(key);
      } else {
        const row = JSON.parse(ch.before) as Record<string, string | number | null>;
        const cols = Object.keys(row);
        db.prepare(`INSERT OR REPLACE INTO ${ch.tbl} (${cols.join(', ')}) VALUES (${cols.map(c => ':' + c).join(', ')})`).run(row);
      }
      reverted++;
    }
    // vom Import angelegte Katalogeinträge entfernen, sofern niemand sie (mehr) nutzt
    for (const id of books) {
      const used = db.prepare(`SELECT 1 FROM copies WHERE book_id = :id UNION ALL SELECT 1 FROM user_books WHERE book_id = :id
        UNION ALL SELECT 1 FROM reviews WHERE book_id = :id UNION ALL SELECT 1 FROM wishlist WHERE book_id = :id
        UNION ALL SELECT 1 FROM list_items WHERE book_id = :id LIMIT 1`).get({ id });
      if (used) { skipped++; continue; }
      const b = db.prepare('SELECT cover FROM books WHERE id = ?').get(id) as { cover: string | null } | undefined;
      db.prepare('DELETE FROM books WHERE id = ?').run(id);
      deleteCoverFile(b?.cover ?? null);
      reverted++;
    }
    db.prepare("UPDATE imports SET undone_at = datetime('now') WHERE id = ?").run(importId);
  });
  return { reverted, skipped, reviewBooks };
}
