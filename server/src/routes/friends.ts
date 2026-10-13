/**
 * Freundschaften: Anfrage schicken (oder eine offene Gegenanfrage annehmen), zurückziehen/ablehnen/beenden.
 * Alles über die Konto-ID der anderen Person, damit Profil und Personenliste denselben Knopf nutzen.
 */
import { HTTPException } from 'hono/http-exception';
import { db, tx } from '../db.ts';
import { requireUser } from '../auth.ts';
import { router, idParam, notFound } from '../util.ts';
import { befriend, unfriend, relationOf } from '../friends.ts';
import { notify } from '../notify.ts';
import { avatarUrl } from './social.ts';

export const friendRoutes = router();

const MAX_OPEN = 50;
const dropNotes = (userId: number, actorId: number) =>
  db.prepare("DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'friend_request'").run(userId, actorId);

/** Offene Anfragen an mich und von mir */
friendRoutes.get('/friends/requests', c => {
  const u = requireUser(c);
  const q = (sql: string) => (db.prepare(sql).all(u.id) as Array<{ id: number; userId: number; displayName: string; username: string; avatar: string | null; createdAt: string }>)
    .map(({ avatar, ...r }) => ({ ...r, avatarUrl: avatarUrl(avatar) }));
  return c.json({
    incoming: q(`SELECT r.id, u.id AS userId, u.display_name AS displayName, u.username, u.avatar, r.created_at AS createdAt
                 FROM friend_requests r JOIN users u ON u.id = r.from_id WHERE r.to_id = ? AND u.disabled = 0 ORDER BY r.created_at DESC`),
    outgoing: q(`SELECT r.id, u.id AS userId, u.display_name AS displayName, u.username, u.avatar, r.created_at AS createdAt
                 FROM friend_requests r JOIN users u ON u.id = r.to_id WHERE r.from_id = ? AND u.disabled = 0 ORDER BY r.created_at DESC`)
  });
});

/** Anfrage schicken; liegt schon eine Anfrage der anderen Person vor, seid ihr direkt befreundet */
friendRoutes.post('/users/:id/friend', c => {
  const u = requireUser(c);
  const id = idParam(c);
  if (id === u.id) throw new HTTPException(400, { message: 'Das bist du selbst' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND disabled = 0').get(id)) throw notFound('Konto');
  const relation = tx(() => {
    const rel = relationOf(u.id, id);
    if (rel === 'friend' || rel === 'outgoing') return rel;
    if (rel === 'incoming') {
      befriend(u.id, id);
      dropNotes(u.id, id);
      notify(id, 'friend_accepted', u.id);
      return 'friend';
    }
    const open = (db.prepare('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ?').get(u.id) as { n: number }).n;
    if (open >= MAX_OPEN) throw new HTTPException(429, { message: 'Zu viele offene Anfragen' });
    db.prepare('INSERT INTO friend_requests (from_id, to_id) VALUES (?, ?)').run(u.id, id);
    notify(id, 'friend_request', u.id);
    return 'outgoing';
  });
  return c.json({ relation });
});

/** Freundschaft beenden, eigene Anfrage zurückziehen oder fremde ablehnen (ohne Benachrichtigung) */
friendRoutes.delete('/users/:id/friend', c => {
  const u = requireUser(c);
  const id = idParam(c);
  tx(() => {
    unfriend(u.id, id);
    db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(u.id, id, id, u.id);
    dropNotes(id, u.id); dropNotes(u.id, id);
  });
  return c.json({ relation: 'none' });
});
