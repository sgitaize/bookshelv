import { db } from './db.ts';

/**
 * Freundschaften: Regal, Aktivität, Wunschliste, Listen, Statistik und Leihanfragen sehen nur befreundete Personen
 * (und nur bei sichtbarem Regal). Alle anderen sehen die Profilkarte (Name, Bild) und können eine Anfrage schicken.
 */

/** SQL-Bedingung: Konto in Spalte col ist mit viewer befreundet (viewer ist eine Konto-ID aus der Sitzung) */
export const friendSql = (viewer: number, col: string) =>
  `EXISTS (SELECT 1 FROM friends fr WHERE fr.user_id = ${Math.trunc(viewer)} AND fr.friend_id = ${col})`;

export const isFriend = (a: number, b: number) =>
  a === b || !!db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(a, b);

export function befriend(a: number, b: number) {
  if (a === b) return;
  const ins = db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)');
  ins.run(a, b); ins.run(b, a);
  db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(a, b, b, a);
}

export function unfriend(a: number, b: number) {
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(a, b, b, a);
}

/** Blockiert: a hat b blockiert oder umgekehrt – dann sehen sich beide nicht mehr und können sich nicht erreichen */
export const isBlocked = (a: number, b: number) =>
  a !== b && !!db.prepare('SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)').get(a, b, b, a);

/** SQL-Bedingung: Konto in Spalte col ist weder von viewer blockiert noch hat es viewer blockiert */
export const notBlockedSql = (viewer: number, col: string) =>
  `NOT EXISTS (SELECT 1 FROM blocks bl WHERE (bl.user_id = ${Math.trunc(viewer)} AND bl.blocked_id = ${col}) OR (bl.user_id = ${col} AND bl.blocked_id = ${Math.trunc(viewer)}))`;

/** Beziehung aus Sicht von me: self | friend | outgoing (ich habe angefragt) | incoming (wartet auf mich) | none */
export type Relation = 'self' | 'friend' | 'outgoing' | 'incoming' | 'none';
export function relationOf(me: number, other: number): Relation {
  if (me === other) return 'self';
  if (isFriend(me, other)) return 'friend';
  if (db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(me, other)) return 'outgoing';
  if (db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(other, me)) return 'incoming';
  return 'none';
}

// ---------- Freund*innen auf gekoppelten Instanzen ----------
// Zustand liegt auf beiden Seiten in remote_friends; Nachrichten FriendRequest/FriendAccept/FriendRemove über die Outbox.
// Das Regal wird nur bei Bedarf signiert abgefragt (/api/fed/shelf) und auf der anderen Seite nicht gespeichert.

export type RemoteStatus = 'friend' | 'outgoing' | 'incoming';
export const remoteStatus = (userId: number, actorId: number) =>
  (db.prepare('SELECT status FROM remote_friends WHERE user_id = ? AND actor_id = ?').get(userId, actorId) as { status: RemoteStatus } | undefined)?.status ?? null;
export const setRemote = (userId: number, actorId: number, status: RemoteStatus) =>
  db.prepare('INSERT INTO remote_friends (user_id, actor_id, status) VALUES (?, ?, ?) ON CONFLICT (user_id, actor_id) DO UPDATE SET status = excluded.status').run(userId, actorId, status);
export const dropRemote = (userId: number, actorId: number) => {
  db.prepare('DELETE FROM remote_friends WHERE user_id = ? AND actor_id = ?').run(userId, actorId);
  db.prepare("DELETE FROM notifications WHERE user_id = ? AND type = 'friend_request' AND actor_id IS NULL AND ref_id = ?").run(userId, actorId);
};
