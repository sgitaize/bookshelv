/**
 * Verleih: ein Exemplar an einen Nutzer der Instanz oder an jemanden per Freitext-Namen.
 * Freitext-Namen (Personen ohne Konto) sieht nur der Verleiher – sie werden nicht im Freundeskreis angezeigt.
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { requireUser, type User } from '../auth.ts';
import { router, body, str, int, idParam, notFound } from '../util.ts';
import { bookBrief } from './books.ts';
import { notify } from '../notify.ts';
import { enqueue, sendNow, upsertActor, parseHandle, handleOf, type Instance } from '../federation.ts';

export const loanRoutes = router();

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const today = () => new Date().toISOString().slice(0, 10);

function date(v: unknown, fallback: string | null): string | null {
  if (v === undefined) return fallback;
  if (v === null || v === '') return null;
  if (!isDate(v)) throw new HTTPException(400, { message: 'Datum im Format JJJJ-MM-TT' });
  return v as string;
}

type LoanRow = {
  id: number; copy_id: number; lender_id: number; borrower_id: number | null; borrower_name: string | null; borrower_remote_id: number | null;
  lent_at: string; due_at: string | null; returned_at: string | null; note: string | null;
};

const LOAN_SELECT = `
  SELECT l.*, le.display_name AS lenderName, bo.display_name AS borrowerDisplay,
         ra.display_name AS remoteName, ra.username AS remoteUser, ri.url AS remoteUrl,
         c.format, c.binding, b.id AS bookId, b.title, b.subtitle, b.authors, b.year, b.pages, b.cover
  FROM loans l
  JOIN copies c ON c.id = l.copy_id
  JOIN books b ON b.id = c.book_id
  JOIN users le ON le.id = l.lender_id
  LEFT JOIN users bo ON bo.id = l.borrower_id
  LEFT JOIN remote_actors ra ON ra.id = l.borrower_remote_id
  LEFT JOIN instances ri ON ri.id = ra.instance_id
`;

function loanJson(r: LoanRow & Record<string, unknown>, me: User) {
  const isLender = r.lender_id === me.id;
  return {
    id: r.id, copyId: r.copy_id, lentAt: r.lent_at, dueAt: r.due_at, returnedAt: r.returned_at,
    overdue: !r.returned_at && !!r.due_at && r.due_at < today(),
    note: isLender || r.borrower_id === me.id ? r.note : null,
    lender: { id: r.lender_id, displayName: r.lenderName as string },
    // Freitext-Namen nur für den Verleiher
    borrower: r.borrower_id
      ? { id: r.borrower_id, displayName: (r.borrowerDisplay as string) ?? '?' }
      : r.remoteName
        ? { id: null, displayName: `${r.remoteName} (${handleOf(r.remoteUser as string, r.remoteUrl as string)})` }
        : isLender ? { id: null, displayName: r.borrower_name ?? '?' } : null,
    mine: isLender,
    copy: { format: r.format, binding: r.binding },
    book: bookBrief(r)
  };
}

/** Offener Verleih je Exemplar (für Buchseite) */
export function openLoanFor(copyId: number) {
  return db.prepare('SELECT * FROM loans WHERE copy_id = ? AND returned_at IS NULL ORDER BY id DESC LIMIT 1').get(copyId) as LoanRow | undefined;
}

loanRoutes.get('/loans', c => {
  const u = requireUser(c);
  const rows = (where: string, order: string, ...args: (number | string)[]) =>
    (db.prepare(`${LOAN_SELECT} WHERE ${where} ORDER BY ${order}`).all(...args) as Array<LoanRow & Record<string, unknown>>).map(r => loanJson(r, u));
  // Leihgaben von Personen auf gekoppelten Instanzen
  const remote = (where: string) => (db.prepare(`
    SELECT rl.*, ra.display_name AS lenderName, ra.username AS lenderUser, i.url,
           b.id AS bookId, b.cover, b.subtitle, b.year, b.pages
    FROM remote_loans rl JOIN remote_actors ra ON ra.id = rl.lender_actor_id JOIN instances i ON i.id = rl.instance_id
    LEFT JOIN books b ON b.isbn13 = rl.isbn13
    WHERE rl.borrower_id = ? AND ${where} ORDER BY rl.lent_at DESC
  `).all(u.id) as Array<Record<string, any>>).map(r => ({
    id: -r.id, remoteLoanId: r.id, copyId: null, lentAt: r.lent_at, dueAt: r.due_at, returnedAt: r.returned_at,
    overdue: !r.returned_at && !!r.due_at && r.due_at < today(), note: r.note,
    lender: { id: null, displayName: `${r.lenderName} (${handleOf(r.lenderUser, r.url)})` }, borrower: null, mine: false,
    copy: { format: 'print', binding: null },
    book: { id: r.bookId ?? null, title: r.title, subtitle: r.subtitle ?? null, authors: JSON.parse(r.authors), year: r.year ?? null, pages: r.pages ?? null, coverUrl: r.cover ? `/covers/${r.cover}` : null }
  }));
  return c.json({
    lent: rows('l.lender_id = ? AND l.returned_at IS NULL', 'l.due_at IS NULL, l.due_at, l.lent_at', u.id),
    borrowed: [...rows('l.borrower_id = ? AND l.returned_at IS NULL', 'l.due_at IS NULL, l.due_at, l.lent_at', u.id), ...remote('rl.returned_at IS NULL')],
    history: rows('(l.lender_id = ? OR l.borrower_id = ?) AND l.returned_at IS NOT NULL', 'l.returned_at DESC LIMIT 50', u.id, u.id)
  });
});

loanRoutes.post('/copies/:id/loans', async c => {
  const u = requireUser(c);
  const copy = db.prepare('SELECT id FROM copies WHERE id = ? AND owner_id = ? AND removed_at IS NULL').get(idParam(c), u.id) as { id: number } | undefined;
  if (!copy) throw notFound('Exemplar');
  if (openLoanFor(copy.id)) throw new HTTPException(409, { message: 'Dieses Exemplar ist schon verliehen' });
  const b = await body(c);
  const borrowerId = int(b.borrowerId, 1, Number.MAX_SAFE_INTEGER);
  const borrowerName = str(b.borrowerName, 80);
  const handle = str(b.borrowerHandle, 120);
  // Person auf einer gekoppelten Instanz: dort nachschlagen
  let remote: { actorId: number; inst: Instance } | null = null;
  if (handle) {
    const h = parseHandle(handle);
    if (!h) throw new HTTPException(400, { message: 'Ungültige Adresse – Format @name@instanz' });
    const inst = (db.prepare(`SELECT * FROM instances WHERE status = 'linked'`).all() as Instance[]).find(i => new URL(i.url).host === h.host);
    if (!inst) throw new HTTPException(400, { message: 'Diese Instanz ist nicht gekoppelt' });
    const res = await sendNow(inst.url, '/api/fed/lookup', { username: h.username });
    if (!res.ok) throw new HTTPException(404, { message: 'Nutzer nicht gefunden' });
    remote = { actorId: upsertActor(inst.id, res.data as { id: number; username: string; displayName: string }), inst };
  }
  if (!borrowerId && !borrowerName && !remote) throw new HTTPException(400, { message: 'An wen? Person auswählen oder Namen eingeben' });
  if (borrowerId === u.id) throw new HTTPException(400, { message: 'An dich selbst kannst du nicht verleihen' });
  if (borrowerId && !db.prepare('SELECT 1 FROM users WHERE id = ? AND disabled = 0').get(borrowerId)) throw notFound('Nutzer');
  const lentAt = date(b.lentAt, today())!;
  const dueAt = date(b.dueAt, null);
  if (dueAt && dueAt < lentAt) throw new HTTPException(400, { message: 'Rückgabe kann nicht vor dem Verleihdatum liegen' });
  const id = Number(db.prepare(`
    INSERT INTO loans (copy_id, lender_id, borrower_id, borrower_remote_id, borrower_name, lent_at, due_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(copy.id, u.id, remote ? null : borrowerId, remote?.actorId ?? null, borrowerId || remote ? null : borrowerName, lentAt, dueAt, str(b.note, 500)).lastInsertRowid);
  const bookId = (db.prepare('SELECT book_id FROM copies WHERE id = ?').get(copy.id) as { book_id: number }).book_id;
  if (remote) offerRemote(id);
  else notify(borrowerId, 'loan_new', u.id, bookId, id);
  return c.json({ id });
});

/** Verleih an eine Person auf einer gekoppelten Instanz dorthin melden (auch nach Änderung der Fälligkeit) */
function offerRemote(loanId: number) {
  const r = db.prepare(`
    SELECT l.*, ra.username AS borrowerUser, ra.instance_id, u.username, u.display_name, b.isbn13, b.title, b.authors
    FROM loans l JOIN remote_actors ra ON ra.id = l.borrower_remote_id JOIN users u ON u.id = l.lender_id
    JOIN copies c ON c.id = l.copy_id JOIN books b ON b.id = c.book_id WHERE l.id = ?
  `).get(loanId) as Record<string, any> | undefined;
  if (!r) return;
  enqueue({
    type: 'LoanOffer',
    loan: { id: r.id, lentAt: r.lent_at, dueAt: r.due_at, note: r.note },
    lender: { id: r.lender_id, username: r.username, displayName: r.display_name },
    borrower: { username: r.borrowerUser },
    book: { isbn13: r.isbn13, title: r.title, authors: JSON.parse(r.authors) }
  }, r.instance_id);
}

const remoteInstanceOf = (loan: LoanRow) => loan.borrower_remote_id
  ? (db.prepare('SELECT instance_id FROM remote_actors WHERE id = ?').get(loan.borrower_remote_id) as { instance_id: number } | undefined)?.instance_id
  : undefined;

function loanFor(u: User, id: number, lenderOnly: boolean) {
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(id) as LoanRow | undefined;
  if (!loan || (loan.lender_id !== u.id && (lenderOnly || loan.borrower_id !== u.id))) throw notFound('Verleih');
  return loan;
}

/** Zurück: dürfen Verleiher und Entleiher markieren */
loanRoutes.post('/loans/:id/return', async c => {
  const u = requireUser(c);
  const loan = loanFor(u, idParam(c), false);
  if (loan.returned_at) return c.json({ ok: true });
  const returnedAt = date((await body(c)).returnedAt, today())!;
  db.prepare('UPDATE loans SET returned_at = ? WHERE id = ?').run(returnedAt < loan.lent_at ? loan.lent_at : returnedAt, loan.id);
  // die jeweils andere Seite informieren
  const bookId = (db.prepare('SELECT book_id FROM copies WHERE id = ?').get(loan.copy_id) as { book_id: number }).book_id;
  notify(u.id === loan.lender_id ? loan.borrower_id : loan.lender_id, 'loan_returned', u.id, bookId, loan.id);
  const inst = remoteInstanceOf(loan);
  if (inst) enqueue({ type: 'LoanReturn', id: loan.id, loanOf: 'sender', returnedAt: returnedAt }, inst);
  return c.json({ ok: true });
});

/** Entleiher hier, Verleiher auf einer gekoppelten Instanz: Rückgabe markieren und dorthin melden */
loanRoutes.post('/remote-loans/:id/return', c => {
  const u = requireUser(c);
  const rl = db.prepare('SELECT * FROM remote_loans WHERE id = ? AND borrower_id = ?').get(idParam(c), u.id) as
    { id: number; instance_id: number; remote_id: number; returned_at: string | null } | undefined;
  if (!rl) throw notFound('Verleih');
  if (!rl.returned_at) {
    db.prepare('UPDATE remote_loans SET returned_at = ? WHERE id = ?').run(today(), rl.id);
    enqueue({ type: 'LoanReturn', id: rl.remote_id, loanOf: 'receiver', returnedAt: today() }, rl.instance_id);
  }
  return c.json({ ok: true });
});

loanRoutes.patch('/loans/:id', async c => {
  const u = requireUser(c);
  const loan = loanFor(u, idParam(c), true);
  const b = await body(c);
  const dueAt = date(b.dueAt, loan.due_at);
  if (dueAt && dueAt < loan.lent_at) throw new HTTPException(400, { message: 'Rückgabe kann nicht vor dem Verleihdatum liegen' });
  db.prepare('UPDATE loans SET due_at = ?, note = ? WHERE id = ?').run(dueAt, b.note === undefined ? loan.note : str(b.note, 500), loan.id);
  if (loan.borrower_remote_id) offerRemote(loan.id);
  return c.json({ ok: true });
});

/** Versehentlich angelegt → löschen (nur Verleiher) */
loanRoutes.delete('/loans/:id', c => {
  const u = requireUser(c);
  const loan = loanFor(u, idParam(c), true);
  const inst = remoteInstanceOf(loan);
  db.prepare('DELETE FROM loans WHERE id = ?').run(loan.id);
  if (inst) enqueue({ type: 'LoanDelete', id: loan.id }, inst);
  return c.json({ ok: true });
});

/** Wird ein Konto gelöscht, bleibt beim Verleiher nur „gelöschtes Konto“ stehen (keine Personendaten) */
export function anonymizeBorrower(userId: number) {
  db.prepare(`UPDATE loans SET borrower_name = '–', borrower_id = NULL WHERE borrower_id = ?`).run(userId);
}
