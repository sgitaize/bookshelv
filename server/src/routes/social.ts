/**
 * Profilbilder, In-App-Benachrichtigungen und der Feed des Freundeskreises.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { loanReminders } from '../notify.ts';
import { config } from '../config.ts';
import { requireUser, requireAdmin } from '../auth.ts';
import { router, body, int, oneOf, idParam, notFound } from '../util.ts';
import { bookBrief } from './books.ts';

export const socialRoutes = router();

const avatarDir = path.join(config.dataDir, 'avatars');
fs.mkdirSync(avatarDir, { recursive: true });

export const avatarUrl = (name: unknown) => (typeof name === 'string' && name ? `/api/avatars/${name}` : null);

// ---------- Profilbilder ----------

/** Dateityp an den ersten Bytes erkennen – der Browser-Angabe wird nicht vertraut */
export function imageType(buf: Buffer): 'webp' | 'jpg' | 'png' | null {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

function removeAvatarFile(name: string | null) {
  if (name && !name.includes('/') && !name.includes('..')) fs.rmSync(path.join(avatarDir, name), { force: true });
}

/** Erwartet ein bereits im Browser verkleinertes Bild als data-URL (JSON bleibt das einzige Upload-Format) */
socialRoutes.post('/me/avatar', async c => {
  const u = requireUser(c);
  const { image } = await body(c);
  const m = typeof image === 'string' ? image.match(/^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!m) throw new HTTPException(400, { message: 'Bild fehlt oder hat ein ungültiges Format' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 400 * 1024) throw new HTTPException(400, { message: 'Bild ist zu groß' });
  const type = imageType(buf);
  if (!type) throw new HTTPException(400, { message: 'Bild fehlt oder hat ein ungültiges Format' });
  const name = `u${u.id}-${crypto.randomBytes(6).toString('hex')}.${type}`;
  fs.writeFileSync(path.join(avatarDir, name), buf);
  const old = (db.prepare('SELECT avatar FROM users WHERE id = ?').get(u.id) as { avatar: string | null }).avatar;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(name, u.id);
  removeAvatarFile(old);
  return c.json({ avatarUrl: avatarUrl(name) });
});

socialRoutes.delete('/me/avatar', c => {
  const u = requireUser(c);
  const old = (db.prepare('SELECT avatar FROM users WHERE id = ?').get(u.id) as { avatar: string | null }).avatar;
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(u.id);
  removeAvatarFile(old);
  return c.json({ ok: true });
});

/** Moderation: Admin entfernt ein unpassendes Profilbild */
socialRoutes.delete('/admin/users/:id/avatar', c => {
  requireAdmin(c);
  const id = idParam(c);
  const row = db.prepare('SELECT avatar FROM users WHERE id = ?').get(id) as { avatar: string | null } | undefined;
  if (!row) throw notFound('Konto');
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(id);
  removeAvatarFile(row.avatar);
  return c.json({ ok: true });
});

/** Profilbilder nur für angemeldete Nutzer (Fotos von Personen) */
socialRoutes.get('/avatars/:name', c => {
  requireUser(c);
  const name = path.basename(c.req.param('name'));
  const file = path.join(avatarDir, name);
  if (!fs.existsSync(file)) return c.body(null, 404);
  const ext = path.extname(name).slice(1);
  c.header('Content-Type', ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  return c.body(fs.readFileSync(file));
});

export function purgeAvatar(userId: number) {
  const row = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId) as { avatar: string | null } | undefined;
  removeAvatarFile(row?.avatar ?? null);
}

// ---------- Benachrichtigungen ----------

const unread = (userId: number) =>
  (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { n: number }).n;

socialRoutes.get('/notifications/count', c => {
  const u = requireUser(c);
  loanReminders(u.id);
  return c.json({ unread: unread(u.id) });
});

socialRoutes.get('/notifications', c => {
  const u = requireUser(c);
  loanReminders(u.id);
  const rows = db.prepare(`
    SELECT n.id, n.type, n.ref_id AS refId, n.created_at AS createdAt, n.read_at AS readAt, n.actor_label AS actorLabel,
           a.id AS actorId, a.display_name AS actorName, a.avatar AS actorAvatar,
           b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover, ls.name AS listName
    FROM notifications n LEFT JOIN users a ON a.id = n.actor_id LEFT JOIN books b ON b.id = n.book_id
    LEFT JOIN lists ls ON n.type = 'list_shared' AND ls.id = n.ref_id
    WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 60
  `).all(u.id) as Array<Record<string, unknown>>;
  return c.json({
    unread: unread(u.id),
    items: rows.map(r => ({
      id: r.id, type: r.type, refId: r.refId, createdAt: r.createdAt, read: !!r.readAt,
      actor: r.actorId ? { id: r.actorId, displayName: r.actorName, avatarUrl: avatarUrl(r.actorAvatar) }
        : r.actorLabel ? { id: null, displayName: r.actorLabel, avatarUrl: null } : null,
      book: r.bookId ? bookBrief(r) : null,
      list: r.listName ? { id: r.refId, name: r.listName } : null
    }))
  });
});

socialRoutes.post('/notifications/read', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isInteger).slice(0, 200) : null;
  if (ids?.length) db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(u.id, ...ids);
  else db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`).run(u.id);
  return c.json({ unread: unread(u.id) });
});

// ---------- Feed ----------

/**
 * Aktivitätsfeed: ins Regal gestellt, angefangen, fertig, abgebrochen, bewertet, zu einer Leseliste hinzugefügt.
 * scope=friends (Standard: alle außer mir), me (nur meine) oder all; ?user= für ein Profil, ?book= als Buch-Historie.
 * Wer sein Regal privat geschaltet hat, erscheint nur bei sich selbst; private Reviews/Listen ebenso.
 * Blättern über ?before=<ts>.
 */
socialRoutes.get('/feed', c => {
  const u = requireUser(c);
  const q = c.req.query();
  const before = q.before ?? '9999';
  const limit = int(q.limit, 1, 100) ?? 30;
  const scope = oneOf(q.scope, ['friends', 'me', 'all'] as const, 'friends');
  const userId = int(q.user, 1, Number.MAX_SAFE_INTEGER);
  const bookId = int(q.book, 1, Number.MAX_SAFE_INTEGER);
  const where = ['e.ts < :before', '(e.user_id = :me OR (u.shelf_visible = 1 AND e.pub = 1))'];
  const params: Record<string, string | number> = { me: u.id, before, limit };
  if (userId) { where.push('e.user_id = :user'); params.user = userId; }
  else if (!bookId && scope === 'friends') where.push('e.user_id != :me');
  else if (!bookId && scope === 'me') where.push('e.user_id = :me');
  if (bookId) { where.push('e.book_id = :book'); params.book = bookId; }
  const rows = db.prepare(`
    SELECT e.* FROM (
      SELECT 'added' AS type, c.created_at AS ts, c.owner_id AS user_id, c.book_id, NULL AS rating, NULL AS text, NULL AS spoiler, NULL AS refId, c.format AS extra, 1 AS pub
        FROM copies c WHERE c.quiet = 0
      UNION ALL
      SELECT 'started', ub.started_at || ' ' || time(ub.updated_at), ub.user_id, ub.book_id, NULL, NULL, NULL, NULL, NULL, 1
        FROM user_books ub WHERE ub.started_at IS NOT NULL AND ub.status != 'unread'
      UNION ALL
      SELECT CASE ub.status WHEN 'dnf' THEN 'dnf' ELSE 'finished' END, ub.finished_at || ' ' || time(ub.updated_at), ub.user_id, ub.book_id, NULL, NULL, NULL, NULL, NULL, 1
        FROM user_books ub WHERE ub.finished_at IS NOT NULL AND ub.status IN ('read', 'dnf')
      UNION ALL
      SELECT 'reviewed', r.updated_at, r.user_id, r.book_id, r.rating, r.text, r.spoiler, r.id, NULL, r.visibility != 'private'
        FROM reviews r WHERE r.quiet = 0
      UNION ALL
      SELECT 'listed', li.added_at, COALESCE(li.added_by, l.user_id), li.book_id, NULL, NULL, NULL, l.id, l.name, l.visibility = 'instance'
        FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.quiet = 0
    ) e
    JOIN users u ON u.id = e.user_id AND u.disabled = 0
    WHERE ${where.join(' AND ')}
    ORDER BY e.ts DESC LIMIT :limit
  `).all(params) as Array<Record<string, unknown>>;
  const users = new Map<number, { displayName: string; avatar: string | null }>();
  const userOf = (id: number) => {
    if (!users.has(id)) users.set(id, db.prepare('SELECT display_name AS displayName, avatar FROM users WHERE id = ?').get(id) as { displayName: string; avatar: string | null });
    return users.get(id)!;
  };
  const items = rows.map(r => {
    const b = db.prepare('SELECT id AS bookId, title, subtitle, authors, year, pages, cover FROM books WHERE id = ?').get(r.book_id as number) as Record<string, unknown>;
    const usr = userOf(r.user_id as number);
    const text = r.text as string | null;
    return {
      type: r.type, ts: r.ts, rating: r.rating, reviewId: r.type === 'reviewed' ? r.refId : null,
      list: r.type === 'listed' ? { id: r.refId, name: r.extra } : null,
      format: r.type === 'added' ? r.extra : null,
      text: r.spoiler ? null : text && text.length > 280 ? text.slice(0, 280) + '…' : text, spoiler: !!r.spoiler,
      user: { id: r.user_id, displayName: usr.displayName, avatarUrl: avatarUrl(usr.avatar) },
      book: bookBrief(b)
    };
  });
  return c.json({ items, next: rows.length === limit ? (rows.at(-1)!.ts as string) : null });
});
