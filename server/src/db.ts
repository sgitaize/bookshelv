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
  `,
  // 2: Spoiler-Markierung für Reviews, Indizes für Feed/Kommentare
  `
  ALTER TABLE reviews ADD COLUMN spoiler INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX reviews_book ON reviews(book_id);
  CREATE INDEX reviews_updated ON reviews(updated_at);
  CREATE INDEX comments_review ON comments(review_id);
  `,
  // 3: Exemplare nur noch als entfernt markieren, damit Verleih- und Buch-Historie erhalten bleiben
  `
  ALTER TABLE copies ADD COLUMN removed_at TEXT;
  ALTER TABLE copies ADD COLUMN removed_reason TEXT CHECK (removed_reason IN ('sold', 'given_away', 'lost', 'other'));
  CREATE INDEX loans_lender ON loans(lender_id);
  -- E-Book-Shops/Plattformen: gemeinsame Liste, Nutzer können neue anlegen
  CREATE TABLE stores (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO stores (name) VALUES ('tolino'), ('Hugendubel'), ('Thalia'), ('Kindle (Amazon)'), ('Apple Books'),
    ('Google Play Books'), ('Kobo'), ('Weltbild'), ('ebook.de'), ('Onleihe'), ('Bücher.de');
  ALTER TABLE copies ADD COLUMN store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL;
  `,
  // 4: Profilbilder und In-App-Benachrichtigungen
  `
  ALTER TABLE users ADD COLUMN avatar TEXT;
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
    ref_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT
  );
  CREATE INDEX notifications_user ON notifications(user_id, read_at);
  CREATE INDEX user_books_finished ON user_books(finished_at);
  `,
  // 5: Föderation – gekoppelte Instanzen, entfernte Personen, föderierte Reviews und Verleihe, Zustellwarteschlange
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE instances (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    name TEXT,
    public_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending_out', 'pending_in', 'linked')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    linked_at TEXT
  );
  CREATE TABLE remote_actors (
    id INTEGER PRIMARY KEY,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    remote_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (instance_id, remote_id)
  );
  CREATE TABLE remote_reviews (
    id INTEGER PRIMARY KEY,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    remote_id INTEGER NOT NULL,
    actor_id INTEGER NOT NULL REFERENCES remote_actors(id) ON DELETE CASCADE,
    isbn13 TEXT NOT NULL,
    rating REAL,
    text TEXT,
    spoiler INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (instance_id, remote_id)
  );
  CREATE INDEX remote_reviews_isbn ON remote_reviews(isbn13);
  CREATE TABLE remote_loans (
    id INTEGER PRIMARY KEY,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    remote_id INTEGER NOT NULL,
    lender_actor_id INTEGER NOT NULL REFERENCES remote_actors(id) ON DELETE CASCADE,
    borrower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    isbn13 TEXT,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',
    lent_at TEXT NOT NULL,
    due_at TEXT,
    returned_at TEXT,
    note TEXT,
    UNIQUE (instance_id, remote_id)
  );
  ALTER TABLE loans ADD COLUMN borrower_remote_id INTEGER REFERENCES remote_actors(id) ON DELETE SET NULL;
  ALTER TABLE notifications ADD COLUMN actor_label TEXT;
  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // 6: Wunschliste
  `
  CREATE TABLE wishlist (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, book_id)
  );
  `,
  // 7: Top 5 im Profil, Leselisten (wie Playlists), Merkmal für den Aktivitätsfeed
  `
  ALTER TABLE user_books ADD COLUMN top_rank INTEGER CHECK (top_rank BETWEEN 1 AND 5);
  CREATE UNIQUE INDEX user_books_top ON user_books(user_id, top_rank) WHERE top_rank IS NOT NULL;
  CREATE TABLE lists (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT NOT NULL DEFAULT 'instance' CHECK (visibility IN ('private', 'instance')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX lists_user ON lists(user_id);
  CREATE TABLE list_items (
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    note TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (list_id, book_id)
  );
  CREATE INDEX list_items_book ON list_items(book_id);
  CREATE INDEX copies_created ON copies(created_at);
  `,
  // 8: Darstellung pro Konto (Farbthema, Schrift) als JSON
  `
  ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';
  `,
  // 9: Importe mit Journal, damit jeder Import rückgängig gemacht werden kann
  `
  CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    filename TEXT,
    total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    undone_at TEXT
  );
  CREATE INDEX imports_user ON imports(user_id);
  -- je geänderter Zeile der Zustand vor dem Import (before NULL = Zeile gab es vorher nicht)
  CREATE TABLE import_changes (
    id INTEGER PRIMARY KEY,
    import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    tbl TEXT NOT NULL,
    key TEXT NOT NULL,
    before TEXT,
    UNIQUE (import_id, tbl, key)
  );
  -- quiet = aus einem Import ohne bekanntes Datum: nicht im Feed (sonst stünde dort „heute hinzugefügt/bewertet“)
  ALTER TABLE copies ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE reviews ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE list_items ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0;
  `,
  // 10: Stimmungen + Tempo an Bewertungen (StoryGraph-Vorbild, für Statistik und Stimmungskurve)
  `
  ALTER TABLE reviews ADD COLUMN moods TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE reviews ADD COLUMN pace TEXT;
  `
];

function migrate() {
  // IMMEDIATE sperrt sofort, damit parallel startende Prozesse nicht doppelt migrieren
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (let v = current; v < migrations.length; v++) db.exec(migrations[v]);
    // nie zurückstufen: läuft ein älterer Stand gegen eine neuere DB, bleibt die Version stehen
    if (current < migrations.length) db.exec(`PRAGMA user_version = ${migrations.length}`);
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
