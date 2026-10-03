import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

fs.mkdirSync(path.join(config.dataDir, 'covers'), { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'bookshelv.db'));
// WAL + busy_timeout: Passenger kann mehrere Prozesse starten, die gleichzeitig auf die Datei zugreifen
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

/** Schema-Migrationen; Index + 1 = PRAGMA user_version nach Ausführung. Nur anhängen, nie ändern. */
const migrations: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    shelf_visible INTEGER NOT NULL DEFAULT 1,
    invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE invites (
    id INTEGER PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_at TEXT
  );
  CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    isbn13 TEXT UNIQUE,
    title TEXT NOT NULL,
    subtitle TEXT,
    authors TEXT NOT NULL DEFAULT '[]',
    publisher TEXT,
    year INTEGER,
    pages INTEGER,
    language TEXT,
    subjects TEXT NOT NULL DEFAULT '[]',
    cover TEXT,
    source TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE copies (
    id INTEGER PRIMARY KEY,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('print', 'ebook')),
    binding TEXT CHECK (binding IN ('paperback', 'hardcover')),
    sprayed_edges INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX copies_owner ON copies(owner_id);
  CREATE INDEX copies_book ON copies(book_id);
  -- Lesestand pro Person und Buch – unabhängig davon, ob man das Buch besitzt oder geliehen hat
  CREATE TABLE user_books (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'read', 'dnf')),
    progress INTEGER,
    started_at TEXT,
    finished_at TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, book_id)
  );
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating REAL CHECK (rating BETWEEN 0.5 AND 5 AND rating * 2 = CAST(rating * 2 AS INTEGER)),
    text TEXT,
    visibility TEXT NOT NULL DEFAULT 'instance' CHECK (visibility IN ('private', 'instance', 'federated')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (book_id, user_id)
  );
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE loans (
    id INTEGER PRIMARY KEY,
    copy_id INTEGER NOT NULL REFERENCES copies(id) ON DELETE CASCADE,
    lender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    borrower_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    borrower_name TEXT,
    lent_at TEXT NOT NULL DEFAULT (date('now')),
    due_at TEXT,
    returned_at TEXT,
    note TEXT
  );
  CREATE INDEX loans_copy ON loans(copy_id);
  CREATE INDEX loans_borrower ON loans(borrower_id);
  `
];

function migrate() {
  // IMMEDIATE sperrt sofort, damit parallel startende Prozesse nicht doppelt migrieren
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (let v = current; v < migrations.length; v++) db.exec(migrations[v]);
    db.exec(`PRAGMA user_version = ${migrations.length}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
migrate();

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
