/**
 * Melden und Blockieren (Registrierung ist offen → App-Store-Richtlinie 1.2).
 * Melden: Reviews, Kommentare, Beiträge in Leserunden und Profile. Der Server merkt sich einen Auszug des Inhalts
 * zum Zeitpunkt der Meldung (falls er danach geändert wird) und benachrichtigt alle Admins (In-App + Web Push).
 * Blockieren: beendet die Freundschaft und offene Anfragen; danach sehen sich beide nicht mehr (Reviews, Kommentare)
 * und können sich nicht mehr anfragen, kommentieren oder einladen.
 */
import { HTTPException } from 'hono/http-exception';
import { db, tx } from '../db.ts';
import { requireUser, requireAdmin, type User } from '../auth.ts';
import { router, body, str, oneOf, idParam, notFound } from '../util.ts';
import { notify } from '../notify.ts';
import { unfriend } from '../friends.ts';
import { avatarUrl, purgeAvatar } from './social.ts';
import { federate } from './reviews.ts';
import { pushAvailable, vapidPublicKey, validEndpoint, subscribe, unsubscribe } from '../push.ts';

export const moderationRoutes = router();

const TYPES = ['review', 'comment', 'user', 'post'] as const;
const REASONS = ['spam', 'offensive', 'harassment', 'spoiler', 'other'] as const;
type Target = { userId: number; excerpt: string | null };

/** Ziel der Meldung prüfen (muss für die meldende Person sichtbar sein) */
function target(u: User, type: (typeof TYPES)[number], id: number): Target {
  let row: { userId: number; excerpt: string | null } | undefined;
  if (type === 'review') row = db.prepare(`SELECT r.user_id AS userId, r.text AS excerpt FROM reviews r WHERE r.id = ? AND (r.user_id = ? OR r.visibility != 'private')`).get(id, u.id) as Target | undefined;
  if (type === 'comment') row = db.prepare('SELECT user_id AS userId, text AS excerpt FROM comments WHERE id = ?').get(id) as Target | undefined;
  if (type === 'post') row = db.prepare(`SELECT p.user_id AS userId, p.text AS excerpt FROM buddy_posts p
    WHERE p.id = ? AND EXISTS (SELECT 1 FROM buddy_members m WHERE m.read_id = p.read_id AND m.user_id = ?)`).get(id, u.id) as Target | undefined;
  if (type === 'user') row = db.prepare("SELECT id AS userId, display_name || ' (@' || username || ')' AS excerpt FROM users WHERE id = ?").get(id) as Target | undefined;
  if (!row) throw notFound('Eintrag');
  return row;
}

moderationRoutes.post('/reports', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const type = oneOf(b.type, TYPES, 'user');
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) throw new HTTPException(400, { message: 'Ungültige ID' });
  const reason = oneOf(b.reason, REASONS, 'other');
  const t = target(u, type, id);
  if (t.userId === u.id) throw new HTTPException(400, { message: 'Eigene Inhalte kannst du nicht melden' });
  // dieselbe Person meldet dasselbe nur einmal, solange es offen ist
  const open = db.prepare('SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND resolved_at IS NULL').get(u.id, type, id) as { id: number } | undefined;
  if (open) return c.json({ ok: true, id: open.id });
  const recent = (db.prepare("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > datetime('now', '-1 hour')").get(u.id) as { n: number }).n;
  if (recent >= 20) throw new HTTPException(429, { message: 'Zu viele Meldungen – bitte später erneut versuchen' });
  const rid = Number(db.prepare(`INSERT INTO reports (reporter_id, target_type, target_id, target_user_id, reason, note, excerpt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(u.id, type, id, t.userId, reason, str(b.note, 500), t.excerpt ? t.excerpt.slice(0, 500) : null).lastInsertRowid);
  for (const a of db.prepare('SELECT id FROM users WHERE is_admin = 1 AND disabled = 0').all() as { id: number }[]) notify(a.id, 'report_new', u.id, null, rid);
  // wer meldet, will den Inhalt meist auch nicht mehr sehen → im Client wird Blockieren direkt angeboten
  return c.json({ ok: true, id: rid });
});

// ---------- Blockieren ----------

moderationRoutes.get('/me/blocks', c => {
  const u = requireUser(c);
  return c.json((db.prepare(`SELECT us.id, us.display_name AS displayName, us.username, us.avatar, b.created_at AS createdAt
    FROM blocks b JOIN users us ON us.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC`).all(u.id) as
    { id: number; displayName: string; username: string; avatar: string | null; createdAt: string }[]).map(({ avatar, ...r }) => ({ ...r, avatarUrl: avatarUrl(avatar) })));
});

moderationRoutes.post('/users/:id/block', c => {
  const u = requireUser(c);
  const id = idParam(c);
  if (id === u.id) throw new HTTPException(400, { message: 'Das bist du selbst' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound('Konto');
  tx(() => {
    db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id) VALUES (?, ?)').run(u.id, id);
    unfriend(u.id, id);
    db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(u.id, id, id, u.id);
    db.prepare("DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type != 'report_new'").run(u.id, id);
  });
  return c.json({ blocked: true });
});

moderationRoutes.delete('/users/:id/block', c => {
  const u = requireUser(c);
  db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(u.id, idParam(c));
  return c.json({ blocked: false });
});

export const blockedByMe = (me: number, other: number) => !!db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').get(me, other);

// ---------- Web Push (Geräte an- und abmelden) ----------

moderationRoutes.get('/push/key', c => {
  requireUser(c);
  if (!pushAvailable()) throw new HTTPException(404, { message: 'Nur mit Konto auf einer Instanz möglich' });
  return c.json({ key: vapidPublicKey() });
});

moderationRoutes.post('/push/subscribe', async c => {
  const u = requireUser(c);
  if (!pushAvailable()) throw new HTTPException(404, { message: 'Nur mit Konto auf einer Instanz möglich' });
  const endpoint = validEndpoint((await body(c)).endpoint);
  if (!endpoint) throw new HTTPException(400, { message: 'Unbekannter Push-Dienst' });
  subscribe(u.id, endpoint);
  return c.json({ ok: true });
});

moderationRoutes.post('/push/unsubscribe', async c => {
  const u = requireUser(c);
  const b = await body(c);
  return c.json({ ok: typeof b.endpoint === 'string' && unsubscribe(u.id, b.endpoint) });
});

// ---------- Admin: Meldungen bearbeiten ----------

type ReportRow = {
  id: number; reporter_id: number | null; target_type: (typeof TYPES)[number]; target_id: number; target_user_id: number | null;
  reason: string; note: string | null; excerpt: string | null; created_at: string; resolved_at: string | null; resolution: string | null;
};

/** Wo der gemeldete Inhalt steht (für den Link im Admin-Bereich); null = inzwischen gelöscht */
function locate(r: ReportRow): { href: string; exists: boolean } {
  if (r.target_type === 'user') return { href: `/people/${r.target_id}`, exists: !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(r.target_id) };
  if (r.target_type === 'review') {
    const x = db.prepare('SELECT book_id FROM reviews WHERE id = ?').get(r.target_id) as { book_id: number } | undefined;
    return { href: x ? `/book/${x.book_id}` : '', exists: !!x };
  }
  if (r.target_type === 'comment') {
    const x = db.prepare('SELECT r.book_id FROM comments c JOIN reviews r ON r.id = c.review_id WHERE c.id = ?').get(r.target_id) as { book_id: number } | undefined;
    return { href: x ? `/book/${x.book_id}` : '', exists: !!x };
  }
  const x = db.prepare('SELECT read_id FROM buddy_posts WHERE id = ?').get(r.target_id) as { read_id: number } | undefined;
  return { href: x ? `/reads/${x.read_id}` : '', exists: !!x };
}

const person = (id: number | null) => {
  if (!id) return null;
  const p = db.prepare('SELECT id, display_name AS displayName, username, disabled FROM users WHERE id = ?').get(id) as { id: number; displayName: string; username: string; disabled: number } | undefined;
  return p ? { ...p, disabled: !!p.disabled } : null;
};

moderationRoutes.get('/admin/reports', c => {
  requireAdmin(c);
  const all = c.req.query('all') === '1';
  const rows = db.prepare(`SELECT * FROM reports ${all ? '' : 'WHERE resolved_at IS NULL'} ORDER BY resolved_at IS NOT NULL, created_at DESC LIMIT 200`).all() as ReportRow[];
  return c.json({
    open: (db.prepare('SELECT COUNT(*) AS n FROM reports WHERE resolved_at IS NULL').get() as { n: number }).n,
    items: rows.map(r => ({
      id: r.id, type: r.target_type, targetId: r.target_id, reason: r.reason, note: r.note, excerpt: r.excerpt, createdAt: r.created_at,
      resolvedAt: r.resolved_at, resolution: r.resolution, reporter: person(r.reporter_id), target: person(r.target_user_id),
      // wie oft dieses Ziel insgesamt gemeldet wurde
      count: (db.prepare('SELECT COUNT(*) AS n FROM reports WHERE target_type = ? AND target_id = ?').get(r.target_type, r.target_id) as { n: number }).n,
      ...locate(r)
    }))
  });
});

/** Meldung erledigen: dismiss (nichts tun), remove (Inhalt löschen; bei Profilen das Profilbild), disable (Konto sperren) */
moderationRoutes.post('/admin/reports/:id/resolve', async c => {
  const me = requireAdmin(c);
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(idParam(c)) as ReportRow | undefined;
  if (!r) throw notFound('Eintrag');
  const action = oneOf((await body(c)).action, ['dismiss', 'remove', 'disable'] as const, 'dismiss');
  if (action === 'disable' && r.target_user_id === me.id) throw new HTTPException(400, { message: 'Du kannst dich nicht selbst entmachten oder sperren' });
  tx(() => {
    if (action === 'remove') {
      if (r.target_type === 'review') {
        const rv = db.prepare('SELECT id, book_id, user_id, visibility FROM reviews WHERE id = ?').get(r.target_id) as { id: number; book_id: number; user_id: number; visibility: string } | undefined;
        if (rv) { db.prepare('DELETE FROM reviews WHERE id = ?').run(rv.id); federate(rv.book_id, rv.user_id, rv.visibility === 'federated' ? rv.id : null); }
      }
      if (r.target_type === 'comment') db.prepare('DELETE FROM comments WHERE id = ?').run(r.target_id);
      if (r.target_type === 'post') db.prepare('DELETE FROM buddy_posts WHERE id = ?').run(r.target_id);
      if (r.target_type === 'user') purgeAvatar(r.target_id);
    }
    if (action === 'disable' && r.target_user_id) {
      db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(r.target_user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(r.target_user_id);
    }
    // alle offenen Meldungen zum selben Ziel gleich mit erledigen
    db.prepare(`UPDATE reports SET resolved_at = datetime('now'), resolved_by = ?, resolution = ? WHERE target_type = ? AND target_id = ? AND resolved_at IS NULL`)
      .run(me.id, action === 'dismiss' ? 'dismissed' : action === 'remove' ? 'removed' : 'disabled', r.target_type, r.target_id);
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE type = 'report_new' AND read_at IS NULL AND ref_id IN (SELECT id FROM reports WHERE resolved_at IS NOT NULL)").run();
  });
  return c.json({ ok: true });
});
