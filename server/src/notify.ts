import { db } from './db.ts';

/**
 * In-App-Benachrichtigungen (es gibt keine E-Mail-Adressen).
 * Typen: loan_new (dir wurde etwas verliehen), loan_returned (Rückgabe), comment (Kommentar auf deine Review),
 *        invite_accepted (deine Einladung wurde angenommen),
 *        import_done (Hintergrund-Import fertig, Dateiname in actor_label, ref_id = imports.id),
 *        loan_due / loan_overdue (Erinnerung an beide Seiten, je Verleih einmal), wish_available (jemand hat ein Buch von deiner Wunschliste),
 *        list_shared (du wurdest zu einer gemeinsamen Liste hinzugefügt, ref_id = lists.id)
 */
export type NotificationType = 'loan_new' | 'loan_returned' | 'comment' | 'invite_accepted' | 'loan_due' | 'loan_overdue' | 'wish_available' | 'import_done' | 'list_shared';

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

/**
 * Verleih-Erinnerungen: fällig in ≤ 2 Tagen bzw. überfällig. Wird beim Abfragen der Glocke erzeugt (kein Cron nötig),
 * je Verleih, Person und Art nur einmal. ref_id = loans.id; bei Freitext-Entleiher*innen steht der Name in actor_label.
 */
export function loanReminders(userId: number) {
  const loans = db.prepare(`
    SELECT l.id, l.lender_id, l.borrower_id, l.borrower_name, l.due_at, c.book_id,
           CASE WHEN l.due_at < date('now') THEN 'loan_overdue' ELSE 'loan_due' END AS kind
    FROM loans l JOIN copies c ON c.id = l.copy_id
    WHERE l.returned_at IS NULL AND l.due_at IS NOT NULL AND l.due_at <= date('now', '+2 days')
      AND (l.lender_id = ? OR l.borrower_id = ?)
  `).all(userId, userId) as { id: number; lender_id: number; borrower_id: number | null; borrower_name: string | null; due_at: string; book_id: number; kind: NotificationType }[];
  const exists = db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND type = ? AND ref_id = ?');
  const ins = db.prepare('INSERT INTO notifications (user_id, type, actor_id, actor_label, book_id, ref_id) VALUES (?, ?, ?, ?, ?, ?)');
  for (const l of loans) {
    if (exists.get(userId, l.kind, l.id)) continue;
    const lender = l.lender_id === userId;
    ins.run(userId, l.kind, lender ? l.borrower_id : l.lender_id, lender && !l.borrower_id ? l.borrower_name : null, l.book_id, l.id);
  }
}

/** Neues Exemplar im Freundeskreis → alle benachrichtigen, die das Buch auf der Wunschliste haben (nur bei sichtbarem Regal) */
export function wishAvailable(ownerId: number, bookId: number) {
  const owner = db.prepare('SELECT shelf_visible FROM users WHERE id = ?').get(ownerId) as { shelf_visible: number } | undefined;
  if (!owner?.shelf_visible) return;
  for (const w of db.prepare('SELECT user_id FROM wishlist WHERE book_id = ? AND user_id != ?').all(bookId, ownerId) as { user_id: number }[])
    notify(w.user_id, 'wish_available', ownerId, bookId);
}
