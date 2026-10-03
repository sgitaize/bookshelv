import { db } from './db.ts';

/**
 * In-App-Benachrichtigungen (es gibt keine E-Mail-Adressen).
 * Typen: loan_new (dir wurde etwas verliehen), loan_returned (Rückgabe), comment (Kommentar auf deine Review),
 *        invite_accepted (deine Einladung wurde angenommen)
 */
export type NotificationType = 'loan_new' | 'loan_returned' | 'comment' | 'invite_accepted';

export function notify(userId: number | null | undefined, type: NotificationType, actorId: number, bookId: number | null = null, refId: number | null = null) {
  if (!userId || userId === actorId) return;
  db.prepare('INSERT INTO notifications (user_id, type, actor_id, book_id, ref_id) VALUES (?, ?, ?, ?, ?)').run(userId, type, actorId, bookId, refId);
  // nicht endlos wachsen lassen: pro Nutzer die letzten 200 behalten
  db.prepare(`DELETE FROM notifications WHERE user_id = ? AND id NOT IN (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 200)`).run(userId, userId);
}

/** Auslöser ist eine Person auf einer gekoppelten Instanz (kein lokales Konto) – Name wird mitgespeichert */
export function notifyRemote(userId: number, type: NotificationType, label: string, bookId: number | null = null, refId: number | null = null) {
  db.prepare('INSERT INTO notifications (user_id, type, actor_label, book_id, ref_id) VALUES (?, ?, ?, ?, ?)').run(userId, type, label, bookId, refId);
}
