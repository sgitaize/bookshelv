/**
 * Lesestand pro Person und Buch (unabhängig vom Besitz), Startseite und Profile.
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { requireUser } from '../auth.ts';
import { router, body, int, oneOf, idParam, notFound } from '../util.ts';
import { bookBrief, getBook, shelf } from './books.ts';
import { avatarUrl } from './social.ts';
import { topOf } from './lists.ts';
import { relationOf } from '../friends.ts';
import { MOODS, PACES, parseMoods } from './reviews.ts';

export const readingRoutes = router();

export const READ_STATUS = ['unread', 'reading', 'read', 'dnf'] as const;
type Status = (typeof READ_STATUS)[number];

export type ReadingRow = {
  user_id: number; book_id: number; status: Status; progress: number | null;
  started_at: string | null; finished_at: string | null; favorite: number; updated_at: string;
};

export const readingJson = (r: ReadingRow | undefined) => ({
  status: r?.status ?? 'unread',
  progress: r?.progress ?? null,
  startedAt: r?.started_at ?? null,
  finishedAt: r?.finished_at ?? null,
  favorite: !!r?.favorite
});

export const today = () => new Date().toISOString().slice(0, 10);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

type Patch = { status?: Status; progress?: number | null; favorite?: boolean; startedAt?: string | null; finishedAt?: string | null };

/** Lesestand setzen; Start-/Enddatum und Fortschritt werden sinnvoll mitgeführt. */
export function setReading(userId: number, bookId: number, p: Patch) {
  const cur = db.prepare('SELECT * FROM user_books WHERE user_id = ? AND book_id = ?').get(userId, bookId) as ReadingRow | undefined;
  const pages = getBook(bookId)?.pages ?? null;
  let status: Status = p.status ?? cur?.status ?? 'unread';
  let progress = p.progress !== undefined ? p.progress : cur?.progress ?? null;
  let started = p.startedAt !== undefined ? p.startedAt : cur?.started_at ?? null;
  let finished = p.finishedAt !== undefined ? p.finishedAt : cur?.finished_at ?? null;

  // Fortschritt eingetragen, aber noch "ungelesen" → jetzt am Lesen
  if (p.progress && !p.status && status === 'unread') status = 'reading';
  if (pages && progress !== null && progress >= pages && !p.status && status === 'reading') status = 'read';

  // Datum nur vorbelegen, wenn keins mitgeschickt wurde – null heißt bewusst „unbekannt“ (z. B. aus einem Import)
  if (status === 'reading') { if (p.startedAt === undefined) started ??= today(); finished = p.finishedAt ?? null; }
  if (status === 'read') { if (p.finishedAt === undefined && cur?.status !== 'read') finished ??= today(); if (pages) progress = pages; }
  if (status === 'unread') { progress = null; started = null; finished = null; }

  db.prepare(`
    INSERT INTO user_books (user_id, book_id, status, progress, started_at, finished_at, favorite, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (user_id, book_id) DO UPDATE SET status = excluded.status, progress = excluded.progress,
      started_at = excluded.started_at, finished_at = excluded.finished_at, favorite = excluded.favorite, updated_at = excluded.updated_at
  `).run(userId, bookId, status, progress, started, finished, p.favorite !== undefined ? (p.favorite ? 1 : 0) : cur?.favorite ?? 0);
}

readingRoutes.put('/books/:id/reading', async c => {
  const u = requireUser(c);
  const id = idParam(c);
  if (!getBook(id)) throw notFound('Buch');
  const b = await body(c);
  const date = (v: unknown) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    if (!isDate(v)) throw new HTTPException(400, { message: 'Datum im Format JJJJ-MM-TT' });
    return v as string;
  };
  const startedAt = date(b.startedAt), finishedAt = date(b.finishedAt);
  if (startedAt && finishedAt && finishedAt < startedAt) throw new HTTPException(400, { message: 'Das Ende liegt vor dem Beginn' });
  if ((startedAt && startedAt > today()) || (finishedAt && finishedAt > today())) throw new HTTPException(400, { message: 'Datum liegt in der Zukunft' });
  setReading(u.id, id, {
    status: b.status === undefined ? undefined : oneOf(b.status, READ_STATUS, 'unread'),
    progress: b.progress === undefined ? undefined : int(b.progress, 0, 100000),
    favorite: typeof b.favorite === 'boolean' ? b.favorite : undefined,
    startedAt, finishedAt
  });
  const row = db.prepare('SELECT * FROM user_books WHERE user_id = ? AND book_id = ?').get(u.id, id) as ReadingRow;
  return c.json(readingJson(row));
});

// ---------- Startseite ----------

const readingList = (userId: number, where: string, order: string, limit = 20) =>
  (db.prepare(`
    SELECT b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover,
           ub.status, ub.progress, ub.started_at AS startedAt, ub.finished_at AS finishedAt
    FROM user_books ub JOIN books b ON b.id = ub.book_id
    WHERE ub.user_id = ? AND ${where} ORDER BY ${order} LIMIT ${limit}
  `).all(userId) as Array<Record<string, unknown>>).map(r => ({
    book: bookBrief(r), status: r.status, progress: r.progress, startedAt: r.startedAt, finishedAt: r.finishedAt
  }));

readingRoutes.get('/home', c => {
  const u = requireUser(c);
  const year = String(new Date().getFullYear());
  const mine = shelf(u.id);
  // pro Buch nur einmal (gedruckt + E-Book desselben Titels zählen als ein Buch)
  const uniq = <T extends { book: { id: number } }>(list: T[]) => list.filter((it, i) => list.findIndex(x => x.book.id === it.book.id) === i);
  const toRead = uniq(mine.filter(it => it.readStatus === 'unread'));
  return c.json({
    reading: readingList(u.id, "ub.status = 'reading'", 'ub.updated_at DESC'),
    recentlyRead: readingList(u.id, "ub.status = 'read'", 'ub.finished_at DESC, ub.updated_at DESC', 12),
    toRead: toRead.slice(0, 12),
    toReadCount: toRead.length,
    recentlyAdded: uniq(mine).slice(0, 12),
    counts: {
      books: uniq(mine).length,
      read: (db.prepare("SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND status = 'read'").get(u.id) as { n: number }).n,
      readThisYear: (db.prepare("SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND status = 'read' AND finished_at LIKE ?").get(u.id, `${year}%`) as { n: number }).n
    }
  });
});

/** Seitenzahl-Klassen für „Was lese ich als Nächstes?“ */
const LENGTHS = { short: [0, 250], medium: [250, 450], long: [450, 1e9] } as const;

/**
 * Zufälliges ungelesenes Buch aus dem eigenen Stapel (eigene Exemplare, Status ungelesen).
 * Stimmung/Tempo stammen aus allen sichtbaren Bewertungen des Buchs (eigene und die der Instanz), das Buch selbst ist ja noch ungelesen.
 * ?skip=1,2,3 lässt schon gezeigte Vorschläge aus (Würfeln ohne Wiederholung, bis der Stapel durch ist).
 */
readingRoutes.get('/home/next', c => {
  const u = requireUser(c);
  const mood = c.req.query('mood') || null, pace = c.req.query('pace') || null, length = c.req.query('length') || null;
  if (mood && !MOODS.includes(mood)) throw new HTTPException(400, { message: `Erlaubt: ${MOODS.join(', ')}` });
  if (pace && !PACES.includes(pace)) throw new HTTPException(400, { message: `Erlaubt: ${PACES.join(', ')}` });
  if (length && !(length in LENGTHS)) throw new HTTPException(400, { message: `Erlaubt: ${Object.keys(LENGTHS).join(', ')}` });
  const skip = new Set((c.req.query('skip') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0));
  const rows = db.prepare(`
    SELECT DISTINCT b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover
    FROM copies c JOIN books b ON b.id = c.book_id
    LEFT JOIN user_books ub ON ub.user_id = c.owner_id AND ub.book_id = b.id
    WHERE c.owner_id = ? AND c.removed_at IS NULL AND COALESCE(ub.status, 'unread') = 'unread'
  `).all(u.id) as Array<Record<string, unknown> & { bookId: number; pages: number | null }>;
  const reviews = db.prepare("SELECT moods, pace FROM reviews WHERE book_id = ? AND (user_id = ? OR visibility != 'private')");
  const matching = rows.filter(r => {
    if (length) {
      const [lo, hi] = LENGTHS[length as keyof typeof LENGTHS];
      if (!r.pages || r.pages < lo || r.pages >= hi) return false;
    }
    if (!mood && !pace) return true;
    const rv = reviews.all(r.bookId, u.id) as { moods: string; pace: string | null }[];
    if (mood && !rv.some(x => parseMoods(x.moods).includes(mood))) return false;
    if (pace && !rv.some(x => x.pace === pace)) return false;
    return true;
  });
  const fresh = matching.filter(r => !skip.has(r.bookId));
  // alle schon gezeigt → von vorn (aber nicht dasselbe Buch zweimal hintereinander, wenn es Alternativen gibt)
  const pool = fresh.length ? fresh : matching.length > 1 ? matching.filter(r => r.bookId !== [...skip].at(-1)) : matching;
  const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  return c.json({ book: pick ? bookBrief(pick) : null, total: rows.length, matching: matching.length, restarted: !fresh.length && !!matching.length });
});

// ---------- Personen ----------

/** Alle Konten der Instanz mit Beziehung zu mir; Bücherzahl nur bei Freund*innen mit sichtbarem Regal */
readingRoutes.get('/users', c => {
  const u = requireUser(c);
  const rows = db.prepare(`
    SELECT u.id, u.display_name AS displayName, u.username, u.shelf_visible AS shelfVisible, u.avatar,
           (SELECT COUNT(DISTINCT book_id) FROM copies WHERE owner_id = u.id AND removed_at IS NULL) AS copies
    FROM users u WHERE u.disabled = 0 ORDER BY u.display_name COLLATE NOCASE
  `).all() as Array<{ id: number; displayName: string; username: string; shelfVisible: number; avatar: string | null; copies: number }>;
  return c.json(rows.map(({ avatar, ...r }) => {
    const relation = relationOf(u.id, r.id);
    const sees = relation === 'self' || (relation === 'friend' && !!r.shelfVisible);
    return { ...r, avatarUrl: avatarUrl(avatar), relation, shelfVisible: sees, copies: sees ? r.copies : null };
  }));
});

function visibleUser(viewerId: number, id: number) {
  const owner = db.prepare('SELECT id, username, display_name AS displayName, shelf_visible AS shelfVisible, created_at AS createdAt, avatar FROM users WHERE id = ? AND disabled = 0').get(id) as
    { id: number; username: string; displayName: string; shelfVisible: number; createdAt: string; avatar: string | null } | undefined;
  if (!owner) throw notFound('Konto');
  const relation = relationOf(viewerId, owner.id);
  return { ...owner, relation, visible: owner.id === viewerId || (!!owner.shelfVisible && relation === 'friend') };
}

readingRoutes.get('/users/:id/shelf', c => {
  const u = requireUser(c);
  const owner = visibleUser(u.id, idParam(c));
  if (!owner.visible) throw new HTTPException(403, { message: 'Dieses Regal ist privat' });
  return c.json({ owner: { id: owner.id, displayName: owner.displayName }, copies: shelf(owner.id).map(cp => ({ ...cp, unsure: false })) });
});

readingRoutes.get('/users/:id/profile', c => {
  const u = requireUser(c);
  const p = visibleUser(u.id, idParam(c));
  const year = String(new Date().getFullYear());
  const n = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  return c.json({
    id: p.id, username: p.username, displayName: p.displayName, createdAt: p.createdAt, shelfVisible: p.visible, avatarUrl: avatarUrl(p.avatar),
    relation: p.relation, friend: p.relation === 'friend',
    // Nicht-Freund*innen sehen nur die Profilkarte
    counts: !p.visible && p.relation !== 'friend' ? null : {
      books: n('SELECT COUNT(DISTINCT book_id) AS n FROM copies WHERE owner_id = ? AND removed_at IS NULL', p.id),
      read: n("SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND status = 'read'", p.id),
      readThisYear: n("SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND status = 'read' AND finished_at LIKE ?", p.id, `${year}%`),
      reviews: n("SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND (user_id = ? OR visibility != 'private')", p.id, u.id)
    },
    averageRating: !p.visible && p.relation !== 'friend' ? null : (db.prepare("SELECT ROUND(AVG(rating), 2) AS a FROM reviews WHERE user_id = ? AND rating IS NOT NULL AND (user_id = ? OR visibility != 'private')").get(p.id, u.id) as { a: number | null }).a,
    top: p.visible ? topOf(p.id) : [],
    favorites: p.visible ? readingList(p.id, 'ub.favorite = 1', 'ub.updated_at DESC', 10).map(r => r.book) : [],
    wishlistCount: p.visible ? n('SELECT COUNT(*) AS n FROM wishlist WHERE user_id = ?', p.id) : 0,
    reading: p.visible ? readingList(p.id, "ub.status = 'reading'", 'ub.updated_at DESC', 10).map(r => r.book) : []
  });
});
