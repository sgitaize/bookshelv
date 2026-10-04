/**
 * Autor*innen folgen + Neuerscheinungen. Quelle: DNB (deutsche Ausgaben, auch Vorankündigungen mit künftigem Jahr).
 * Die DNB liefert viel Rauschen (Neuauflagen, Bundles, Hörbücher, Übersetzungen, Merchandise), daher:
 *  - nur mat=books, Autor*in muss in den Personen stehen, Sprache wie die eigenen Bücher dieser Person (sonst Deutsch),
 *  - Ausgaben-Varianten raus (Bundle, Lesung, Graphic Novel, limitierte Auflage …),
 *  - je Titel einmal gegenprüfen: Gibt es ihn schon aus früheren Jahren, ist es eine Neuauflage (is_new = 0).
 * Erste Prüfung einer Person = Bestand merken, ohne Glocke. Danach meldet jeder neue Titel `author_new` an alle Folgenden.
 * Geprüft wird höchstens einmal am Tag je Person, nacheinander mit Pause (DNB nicht überlasten).
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { requireUser } from '../auth.ts';
import { router, body, str } from '../util.ts';
import { dnbQuery, type BookData } from '../catalog.ts';
import { notifyRemote } from '../notify.ts';
import { getBookByIsbn } from './books.ts';

export const authorRoutes = router();

const MAX_FOLLOWS = 100;
const year = () => new Date().getFullYear();

export const normTitle = (t: string) => t.toLocaleLowerCase('de').replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const normName = (n: string) => n.toLocaleLowerCase('de').replace(/[^\p{L}]+/gu, ' ').trim();
const VARIANT = /(bundle|2in1|sammelband|lesung|hörbuch|hörspiel|graphic novel|limitiert|sonderausgabe|schuber|box|kalender|socken|tasse|poster|puzzle|notizbuch)/i;

const hasAuthor = (b: BookData, author: string) => {
  const want = normName(author).split(' ');
  return b.authors.some(a => { const n = normName(a); return want.every(w => n.includes(w)); });
};

/** Sprache, in der man die Person liest (häufigste Sprache ihrer Bücher in der Instanz), sonst Deutsch */
function languageFor(author: string): string {
  const rows = db.prepare(`SELECT language, COUNT(*) AS n FROM books WHERE language IS NOT NULL AND authors LIKE ? GROUP BY language ORDER BY n DESC LIMIT 1`)
    .get(`%${author.replace(/[%_]/g, '')}%`) as { language: string } | undefined;
  return rows?.language ?? 'ger';
}

/** Eine Person prüfen; gibt die neu gemeldeten Release-IDs zurück */
export async function checkAuthor(author: string): Promise<number[]> {
  const y = year();
  const check = db.prepare('SELECT * FROM author_checks WHERE author = ?').get(author) as { seeded: number } | undefined;
  const lang = languageFor(author);
  // die DNB findet je nach Schreibweise unterschiedliche Datensätze: „Vorname Nachname“ und „Nachname, Vorname“
  const clean = author.replace(/"/g, '');
  const parts = clean.split(' ');
  const forms = [clean, ...(parts.length > 1 && !clean.includes(',') ? [`${parts.at(-1)}, ${parts.slice(0, -1).join(' ')}`] : [])];
  const raw: BookData[] = [];
  for (const f of forms) raw.push(...await dnbQuery(`per="${f}" and jhr>=${y - 1} and mat=books`, 60));
  const hits = raw
    .filter(b => b.year && b.year >= y - 1 && hasAuthor(b, author) && (!b.language || b.language === lang) && !VARIANT.test(`${b.title} ${b.subtitle ?? ''}`));
  const byTitle = new Map<string, BookData>();
  for (const b of hits) { const k = normTitle(b.title); if (k && !byTitle.has(k)) byTitle.set(k, b); }
  const known = db.prepare('SELECT 1 FROM author_releases WHERE author = ? AND norm_title = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO author_releases (author, norm_title, title, isbn13, year, is_new) VALUES (?, ?, ?, ?, ?, ?)');
  const fresh: number[] = [];
  for (const [k, b] of byTitle) {
    if (known.get(author, k)) continue;
    // Gegenprobe: denselben Titel ohne Jahresgrenze suchen – ältere Ausgabe vorhanden ⇒ Neuauflage
    const older = (await dnbQuery(`per="${author.replace(/"/g, '')}" and tit="${b.title.replace(/"/g, '')}"`, 30))
      .some(o => o.year && o.year < y - 1 && normTitle(o.title) === k);
    const r = insert.run(author, k, b.title, b.isbn13, b.year, older ? 0 : 1);
    if (r.changes && !older) fresh.push(Number(r.lastInsertRowid));
    await new Promise(res => setTimeout(res, 300));
  }
  db.prepare(`INSERT INTO author_checks (author, checked_at, seeded) VALUES (?, datetime('now'), 1)
    ON CONFLICT(author) DO UPDATE SET checked_at = excluded.checked_at, seeded = 1`).run(author);
  if (!check?.seeded) return []; // erste Prüfung: nur Bestand merken
  const followers = db.prepare('SELECT user_id FROM author_follows WHERE author = ?').all(author) as { user_id: number }[];
  for (const id of fresh) {
    const rel = db.prepare('SELECT isbn13 FROM author_releases WHERE id = ?').get(id) as { isbn13: string | null };
    const local = rel.isbn13 ? getBookByIsbn(rel.isbn13) : undefined;
    for (const f of followers) notifyRemote(f.user_id, 'author_new', author, local?.id ?? null, id);
  }
  return fresh;
}

let running = false;
/** Fällige Personen prüfen (älter als 24 h), höchstens 30 je Lauf */
export async function checkAuthors() {
  if (running) return;
  running = true;
  try {
    const due = db.prepare(`
      SELECT DISTINCT f.author FROM author_follows f LEFT JOIN author_checks c ON c.author = f.author
      WHERE c.checked_at IS NULL OR c.checked_at < datetime('now', '-1 day') LIMIT 30
    `).all() as { author: string }[];
    for (const d of due) {
      await checkAuthor(d.author).catch(e => console.error('Neuerscheinungen', d.author, e));
      await new Promise(r => setTimeout(r, 1500));
    }
  } finally { running = false; }
}

function releasesOf(author: string) {
  return (db.prepare(`SELECT * FROM author_releases WHERE author = ? AND is_new = 1 AND year >= ? ORDER BY year DESC, first_seen DESC LIMIT 20`)
    .all(author, year() - 1) as { id: number; title: string; isbn13: string | null; year: number; first_seen: string }[])
    .map(r => {
      const local = r.isbn13 ? getBookByIsbn(r.isbn13) : undefined;
      return {
        id: r.id, title: r.title, isbn13: r.isbn13, year: r.year, firstSeen: r.first_seen, upcoming: r.year > year(),
        bookId: local?.id ?? null, coverUrl: local?.cover ? `/covers/${local.cover}` : r.isbn13 ? `/api/catalog/cover?isbn=${r.isbn13}` : null
      };
    });
}

/** Gefolgte Personen mit Neuerscheinungen + Vorschläge (meistgelesene/gut bewertete Personen, denen ich noch nicht folge) */
authorRoutes.get('/authors', c => {
  const u = requireUser(c);
  const follows = (db.prepare('SELECT f.author, c.checked_at AS checkedAt FROM author_follows f LEFT JOIN author_checks c ON c.author = f.author WHERE f.user_id = ? ORDER BY f.author').all(u.id) as { author: string; checkedAt: string | null }[]);
  const counts = new Map<string, number>();
  const rows = db.prepare(`
    SELECT b.authors FROM user_books ub JOIN books b ON b.id = ub.book_id
    LEFT JOIN reviews r ON r.book_id = b.id AND r.user_id = ub.user_id
    WHERE ub.user_id = ? AND (ub.status = 'read' OR ub.favorite = 1 OR r.rating >= 4)
  `).all(u.id) as { authors: string }[];
  for (const r of rows) for (const a of JSON.parse(r.authors) as string[]) counts.set(a, (counts.get(a) ?? 0) + 1);
  const followed = new Set(follows.map(f => f.author));
  const suggestions = [...counts].filter(([a, n]) => n >= 2 && !followed.has(a)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, n }));
  return c.json({ follows: follows.map(f => ({ name: f.author, checkedAt: f.checkedAt, releases: releasesOf(f.author) })), suggestions });
});

authorRoutes.get('/authors/following', c => {
  const u = requireUser(c);
  return c.json((db.prepare('SELECT author FROM author_follows WHERE user_id = ?').all(u.id) as { author: string }[]).map(r => r.author));
});

authorRoutes.post('/authors/follow', async c => {
  const u = requireUser(c);
  const name = str((await body(c)).name, 120);
  if (!name) throw new HTTPException(400, { message: 'Name fehlt' });
  const n = (db.prepare('SELECT COUNT(*) AS n FROM author_follows WHERE user_id = ?').get(u.id) as { n: number }).n;
  if (n >= MAX_FOLLOWS) throw new HTTPException(400, { message: `Höchstens ${MAX_FOLLOWS} Autor*innen` });
  db.prepare('INSERT OR IGNORE INTO author_follows (user_id, author) VALUES (?, ?)').run(u.id, name);
  // neue Person gleich im Hintergrund prüfen, damit die Seite bald etwas zeigt
  if (!db.prepare('SELECT 1 FROM author_checks WHERE author = ?').get(name)) checkAuthor(name).catch(() => {});
  return c.json({ ok: true });
});

authorRoutes.post('/authors/unfollow', async c => {
  const u = requireUser(c);
  db.prepare('DELETE FROM author_follows WHERE user_id = ? AND author = ?').run(u.id, str((await body(c)).name, 120));
  return c.json({ ok: true });
});
