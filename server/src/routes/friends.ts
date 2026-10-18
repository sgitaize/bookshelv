/**
 * Freundschaften: Anfrage schicken (oder eine offene Gegenanfrage annehmen), zurückziehen/ablehnen/beenden.
 * Alles über die Konto-ID der anderen Person, damit Profil und Personenliste denselben Knopf nutzen.
 */
import { HTTPException } from 'hono/http-exception';
import { db, tx } from '../db.ts';
import { requireUser } from '../auth.ts';
import { router, idParam, notFound, body, str } from '../util.ts';
import { befriend, unfriend, relationOf, remoteStatus, setRemote, dropRemote, isBlocked } from '../friends.ts';
import { enqueue, sendNow, resolveHandle, handleOf, type Instance } from '../federation.ts';
import { localActor } from './federation.ts';
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
  if (isBlocked(u.id, id)) throw new HTTPException(403, { message: 'Nicht möglich' });
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

// ---------- Personen auf gekoppelten Instanzen ----------

type ActorRow = { id: number; username: string; display_name: string; remote_id: number; instance_id: number; url: string; name: string | null; status: string };
const actorOf = (id: number) => {
  const a = db.prepare(`SELECT ra.id, ra.username, ra.display_name, ra.remote_id, ra.instance_id, i.url, i.name, i.status
    FROM remote_actors ra JOIN instances i ON i.id = ra.instance_id WHERE ra.id = ?`).get(id) as ActorRow | undefined;
  if (!a || a.status !== 'linked') throw notFound('Konto');
  return a;
};
/** Relation wie bei lokalen Konten: friend | outgoing | incoming | none */
const remoteCard = (me: number, a: ActorRow) => ({
  actorId: a.id, displayName: a.display_name, username: a.username, handle: handleOf(a.username, a.url), instance: a.name ?? new URL(a.url).host,
  relation: remoteStatus(me, a.id) ?? 'none'
});

/** Alle entfernten Personen, mit denen ich befreundet bin oder eine Anfrage offen ist */
friendRoutes.get('/friends/remote', c => {
  const u = requireUser(c);
  const ids = db.prepare('SELECT actor_id FROM remote_friends WHERE user_id = ?').all(u.id) as { actor_id: number }[];
  const out = [];
  for (const { actor_id } of ids) { try { out.push(remoteCard(u.id, actorOf(actor_id))); } catch { /* Instanz nicht mehr gekoppelt */ } }
  // linked: gibt es überhaupt gekoppelte Instanzen (sonst blendet die App die Suche nach @name@instanz aus)
  const linked = !!db.prepare("SELECT 1 FROM instances WHERE status = 'linked'").get();
  return c.json({ linked, people: out.sort((a, b) => a.displayName.localeCompare(b.displayName)) });
});

/** "@name@instanz" suchen */
friendRoutes.post('/friends/remote/lookup', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const { actorId } = await resolveHandle(str(b.handle, 120) ?? '');
  return c.json(remoteCard(u.id, actorOf(actorId)));
});

friendRoutes.get('/remote/:id', c => c.json(remoteCard(requireUser(c).id, actorOf(idParam(c)))));

friendRoutes.post('/remote/:id/friend', c => {
  const u = requireUser(c);
  const a = actorOf(idParam(c));
  const cur = remoteStatus(u.id, a.id);
  if (cur === 'friend' || cur === 'outgoing') return c.json({ relation: cur });
  if (cur !== 'incoming') {
    const open = (db.prepare("SELECT COUNT(*) AS n FROM remote_friends WHERE user_id = ? AND status = 'outgoing'").get(u.id) as { n: number }).n;
    if (open >= MAX_OPEN) throw new HTTPException(429, { message: 'Zu viele offene Anfragen' });
  }
  const next = cur === 'incoming' ? 'friend' : 'outgoing';
  setRemote(u.id, a.id, next);
  if (next === 'friend') db.prepare("DELETE FROM notifications WHERE user_id = ? AND type = 'friend_request' AND actor_id IS NULL AND ref_id = ?").run(u.id, a.id);
  enqueue({ type: next === 'friend' ? 'FriendAccept' : 'FriendRequest', from: localActor(u.id), to: { username: a.username } }, a.instance_id);
  return c.json({ relation: next });
});

friendRoutes.delete('/remote/:id/friend', c => {
  const u = requireUser(c);
  const a = actorOf(idParam(c));
  if (remoteStatus(u.id, a.id)) {
    dropRemote(u.id, a.id);
    enqueue({ type: 'FriendRemove', from: localActor(u.id), to: { username: a.username } }, a.instance_id);
  }
  return c.json({ relation: 'none' });
});

/** Regal einer befreundeten Person auf einer anderen Instanz (live abgefragt, Cover über den eigenen Katalog) */
friendRoutes.get('/remote/:id/shelf', async c => {
  const u = requireUser(c);
  const a = actorOf(idParam(c));
  if (remoteStatus(u.id, a.id) !== 'friend') throw new HTTPException(403, { message: 'Ihr seid nicht befreundet' });
  const inst = db.prepare('SELECT * FROM instances WHERE id = ?').get(a.instance_id) as Instance;
  const res = await sendNow(inst.url, '/api/fed/shelf', { viewer: localActor(u.id), username: a.username });
  if (res.status === 403) throw new HTTPException(403, { message: 'Ihr seid nicht befreundet' });
  if (!res.ok) throw new HTTPException(502, { message: 'Die andere Instanz antwortet gerade nicht' });
  const d = res.data as { visible: boolean; copies: Array<{ isbn13: string | null; title: string; subtitle: string | null; authors: string[]; year: number | null; pages: number | null; format: string; readStatus: string }> };
  const local = db.prepare('SELECT id, cover FROM books WHERE isbn13 = ?');
  return c.json({
    ...remoteCard(u.id, a), visible: !!d.visible,
    copies: (Array.isArray(d.copies) ? d.copies : []).slice(0, 3000).map(r => {
      const isbn = typeof r.isbn13 === 'string' && /^\d{13}$/.test(r.isbn13) ? r.isbn13 : null;
      const b = isbn ? local.get(isbn) as { id: number; cover: string | null } | undefined : undefined;
      return {
        format: String(r.format), readStatus: String(r.readStatus), isbn13: isbn, localBookId: b?.id ?? null,
        book: { id: b?.id ?? 0, title: String(r.title ?? '?').slice(0, 300), subtitle: r.subtitle ? String(r.subtitle).slice(0, 300) : null,
          authors: Array.isArray(r.authors) ? r.authors.slice(0, 10).map(String) : [], year: Number.isInteger(r.year) ? r.year : null, pages: Number.isInteger(r.pages) ? r.pages : null,
          coverUrl: b?.cover ? `/covers/${b.cover}` : isbn ? `/api/catalog/cover?isbn=${isbn}` : null }
      };
    })
  });
});

/** Beim Löschen eines Kontos: entfernte Freund*innen informieren */
export function retractRemoteFriends(userId: number) {
  const rows = db.prepare('SELECT rf.actor_id, ra.username, ra.instance_id FROM remote_friends rf JOIN remote_actors ra ON ra.id = rf.actor_id WHERE rf.user_id = ?')
    .all(userId) as { actor_id: number; username: string; instance_id: number }[];
  for (const r of rows) enqueue({ type: 'FriendRemove', from: localActor(userId), to: { username: r.username } }, r.instance_id);
}
