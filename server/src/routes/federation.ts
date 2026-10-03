/**
 * Föderation – Endpunkte: Info, Posteingang, Personensuche (für gekoppelte Instanzen) und Admin-Verwaltung.
 */
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { config } from '../config.ts';
import { requireAdmin, requireUser } from '../auth.ts';
import { router, body, str, idParam, notFound } from '../util.ts';
import { normalizeIsbn } from '../catalog.ts';
import { notifyRemote } from '../notify.ts';
import { importIsbn } from './books.ts';
import {
  selfUrl, rememberSelfUrl, instanceName, setSetting, publicKey, normalizeUrl, verify, fetchInfo, sendNow, enqueue,
  upsertActor, kickDelivery, handleOf, type Instance
} from '../federation.ts';

export const federationRoutes = router();

const getInstanceByUrl = (url: string) => db.prepare('SELECT * FROM instances WHERE url = ?').get(url) as Instance | undefined;

federationRoutes.get('/fed/info', c => c.json({
  software: 'bookshelv', version: config.version, name: instanceName(), url: selfUrl(), publicKey: publicKey()
}));

// ---------- Posteingang ----------

type Msg = Record<string, any>;

/** Signatur prüfen: gegen den gespeicherten Schlüssel (gekoppelt/ausstehend) */
async function verified(c: Context): Promise<{ inst: Instance | null; origin: string; msg: Msg; raw: string }> {
  const raw = await c.req.text();
  if (raw.length > 256 * 1024) throw new HTTPException(413, { message: 'Zu groß' });
  const origin = normalizeUrl(c.req.header('x-bs-origin') ?? '');
  if (!origin) throw new HTTPException(400, { message: 'Absender fehlt' });
  let msg: Msg;
  try { msg = JSON.parse(raw); } catch { throw new HTTPException(400, { message: 'Ungültige Anfrage (JSON erwartet)' }); }
  const inst = getInstanceByUrl(origin) ?? null;
  if (inst && !verify(raw, c.req.header('x-bs-date'), c.req.header('x-bs-signature'), inst.public_key))
    throw new HTTPException(401, { message: 'Signatur ungültig' });
  return { inst, origin, msg, raw };
}

federationRoutes.post('/fed/inbox', async c => {
  kickDelivery();
  const { inst, origin, msg, raw } = await verified(c);

  if (msg.type === 'LinkRequest') {
    if (inst?.status === 'linked') return c.json({ ok: true });
    // Schlüssel von der behaupteten Absender-URL holen, damit sich niemand als andere Instanz ausgibt
    const info = await fetchInfo(origin);
    if (!info || !verify(raw, c.req.header('x-bs-date'), c.req.header('x-bs-signature'), info.publicKey))
      throw new HTTPException(401, { message: 'Signatur ungültig' });
    if (inst?.status === 'pending_out') {
      // beide Seiten wollten koppeln → sofort gekoppelt
      db.prepare(`UPDATE instances SET status = 'linked', public_key = ?, name = ?, linked_at = datetime('now') WHERE id = ?`).run(info.publicKey, info.name, inst.id);
      enqueue({ type: 'LinkAccept', name: instanceName() }, inst.id);
      backfill(inst.id);
      return c.json({ ok: true, status: 'linked' });
    }
    const pending = (db.prepare(`SELECT COUNT(*) AS n FROM instances WHERE status = 'pending_in'`).get() as { n: number }).n;
    if (pending >= 20) throw new HTTPException(429, { message: 'Zu viele offene Anfragen' });
    db.prepare(`INSERT OR IGNORE INTO instances (url, name, public_key, status) VALUES (?, ?, ?, 'pending_in')`).run(origin, info.name, info.publicKey);
    return c.json({ ok: true, status: 'pending' }, 202);
  }

  if (!inst) throw new HTTPException(403, { message: 'Nicht gekoppelt' });

  if (msg.type === 'LinkAccept') {
    if (inst.status === 'pending_out') {
      db.prepare(`UPDATE instances SET status = 'linked', name = COALESCE(?, name), linked_at = datetime('now') WHERE id = ?`).run(str(msg.name, 80), inst.id);
      backfill(inst.id);
    }
    return c.json({ ok: true });
  }
  if (msg.type === 'Unlink') {
    unlinkCleanup(inst);
    return c.json({ ok: true });
  }
  if (inst.status !== 'linked') throw new HTTPException(403, { message: 'Nicht gekoppelt' });

  switch (msg.type) {
    case 'Review': {
      const r = msg.review ?? {};
      const isbn = normalizeIsbn(String(r.isbn13 ?? ''));
      if (!isbn || !Number.isInteger(r.id)) throw new HTTPException(400, { message: 'Ungültige Review' });
      const actor = upsertActor(inst.id, msg.actor);
      const rating = typeof r.rating === 'number' && r.rating >= 0.5 && r.rating <= 5 ? Math.round(r.rating * 2) / 2 : null;
      db.prepare(`
        INSERT INTO remote_reviews (instance_id, remote_id, actor_id, isbn13, rating, text, spoiler, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (instance_id, remote_id) DO UPDATE SET rating = excluded.rating, text = excluded.text, spoiler = excluded.spoiler, updated_at = excluded.updated_at
      `).run(inst.id, r.id, actor, isbn, rating, str(r.text, 10000), r.spoiler ? 1 : 0, String(r.createdAt ?? ''), String(r.updatedAt ?? ''));
      return c.json({ ok: true });
    }
    case 'ReviewDelete':
      db.prepare('DELETE FROM remote_reviews WHERE instance_id = ? AND remote_id = ?').run(inst.id, Number(msg.id));
      return c.json({ ok: true });
    case 'LoanOffer': {
      // Ein Nutzer der anderen Instanz verleiht einem unserer Nutzer ein Buch (oder ändert die Fälligkeit)
      const borrower = db.prepare('SELECT id FROM users WHERE username = ? AND disabled = 0').get(String(msg.borrower?.username ?? '')) as { id: number } | undefined;
      if (!borrower) throw new HTTPException(404, { message: 'Konto nicht gefunden' });
      const actor = upsertActor(inst.id, msg.lender);
      const l = msg.loan ?? {};
      const isbn = msg.book?.isbn13 ? normalizeIsbn(String(msg.book.isbn13)) : null;
      const existing = db.prepare('SELECT id FROM remote_loans WHERE instance_id = ? AND remote_id = ?').get(inst.id, l.id);
      db.prepare(`
        INSERT INTO remote_loans (instance_id, remote_id, lender_actor_id, borrower_id, isbn13, title, authors, lent_at, due_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (instance_id, remote_id) DO UPDATE SET due_at = excluded.due_at, note = excluded.note
      `).run(inst.id, l.id, actor, borrower.id, isbn, str(msg.book?.title, 300) ?? '?', JSON.stringify(Array.isArray(msg.book?.authors) ? msg.book.authors.slice(0, 10) : []),
        String(l.lentAt ?? '').slice(0, 10), l.dueAt ? String(l.dueAt).slice(0, 10) : null, str(l.note, 500));
      if (!existing) {
        const local = isbn ? db.prepare('SELECT id FROM books WHERE isbn13 = ?').get(isbn) as { id: number } | undefined : undefined;
        // Buch im Hintergrund in den eigenen Katalog holen, damit Cover und Buchseite da sind
        if (isbn && !local) importIsbn(isbn, borrower.id).catch(() => {});
        notifyRemote(borrower.id, 'loan_new', `${msg.lender?.displayName} (${handleOf(msg.lender?.username, inst.url)})`, local?.id ?? null);
      }
      return c.json({ ok: true });
    }
    case 'LoanReturn': {
      const when = String(msg.returnedAt ?? new Date().toISOString()).slice(0, 10);
      if (msg.loanOf === 'sender') {
        // die andere Instanz ist Verleiher → betrifft unsere remote_loans
        db.prepare('UPDATE remote_loans SET returned_at = COALESCE(returned_at, ?) WHERE instance_id = ? AND remote_id = ?').run(when, inst.id, Number(msg.id));
      } else {
        // wir sind Verleiher, die entfernte Person hat zurückgegeben
        const loan = db.prepare(`
          SELECT l.id, l.lender_id, c.book_id, ra.display_name, ra.username FROM loans l JOIN copies c ON c.id = l.copy_id
          JOIN remote_actors ra ON ra.id = l.borrower_remote_id WHERE l.id = ? AND ra.instance_id = ?
        `).get(Number(msg.id), inst.id) as { id: number; lender_id: number; book_id: number; display_name: string; username: string } | undefined;
        if (loan) {
          db.prepare('UPDATE loans SET returned_at = COALESCE(returned_at, ?) WHERE id = ?').run(when, loan.id);
          notifyRemote(loan.lender_id, 'loan_returned', `${loan.display_name} (${handleOf(loan.username, inst.url)})`, loan.book_id, loan.id);
        }
      }
      return c.json({ ok: true });
    }
    case 'LoanDelete':
      db.prepare('DELETE FROM remote_loans WHERE instance_id = ? AND remote_id = ?').run(inst.id, Number(msg.id));
      return c.json({ ok: true });
    default:
      throw new HTTPException(400, { message: 'Unbekannter Nachrichtentyp' });
  }
});

/** Gekoppelte Instanz fragt nach einem unserer Nutzer (für Verleih an @name@diese-instanz) */
federationRoutes.post('/fed/lookup', async c => {
  const { inst, msg } = await verified(c);
  if (!inst || inst.status !== 'linked') throw new HTTPException(403, { message: 'Nicht gekoppelt' });
  const u = db.prepare('SELECT id, username, display_name AS displayName FROM users WHERE username = ? AND disabled = 0')
    .get(String(msg.username ?? '')) as { id: number; username: string; displayName: string } | undefined;
  if (!u) throw new HTTPException(404, { message: 'Konto nicht gefunden' });
  return c.json(u);
});

// ---------- Hilfen ----------

/** Nach dem Koppeln: alle föderierten Reviews an die neue Instanz schicken */
function backfill(instanceId: number) {
  const rows = db.prepare(`
    SELECT r.*, u.username, u.display_name, b.isbn13 FROM reviews r JOIN users u ON u.id = r.user_id JOIN books b ON b.id = r.book_id
    WHERE r.visibility = 'federated' AND b.isbn13 IS NOT NULL AND u.disabled = 0
  `).all() as Array<Record<string, any>>;
  for (const r of rows) enqueue(reviewMessage(r), instanceId);
}

export function reviewMessage(r: Record<string, any>) {
  return {
    type: 'Review',
    actor: { id: r.user_id, username: r.username, displayName: r.display_name },
    review: { id: r.id, isbn13: r.isbn13, rating: r.rating, text: r.text, spoiler: !!r.spoiler, createdAt: r.created_at, updatedAt: r.updated_at }
  };
}

/** Kopplung lösen: Verleihe an Personen dort als Freitext behalten, alles von dort löschen */
function unlinkCleanup(inst: Instance) {
  db.prepare(`
    UPDATE loans SET borrower_name = (SELECT display_name || ' (@' || username || ')' FROM remote_actors WHERE id = loans.borrower_remote_id), borrower_remote_id = NULL
    WHERE borrower_remote_id IN (SELECT id FROM remote_actors WHERE instance_id = ?)
  `).run(inst.id);
  db.prepare('DELETE FROM instances WHERE id = ?').run(inst.id);
}

// ---------- Admin ----------

federationRoutes.get('/admin/federation', c => {
  requireAdmin(c);
  // Hinter Plesk/nginx kommt die Anfrage intern per http an – außer bei localhost gilt https
  const host = c.req.header('host') ?? '';
  const proto = c.req.header('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
  rememberSelfUrl(`${proto}://${host}`);
  const instances = db.prepare(`
    SELECT i.id, i.url, i.name, i.status, i.created_at AS createdAt, i.linked_at AS linkedAt,
           (SELECT COUNT(*) FROM remote_reviews WHERE instance_id = i.id) AS reviews,
           (SELECT COUNT(*) FROM outbox WHERE instance_id = i.id) AS queued
    FROM instances i ORDER BY i.status, i.url
  `).all();
  return c.json({ url: selfUrl(), name: instanceName(), urlFromEnv: !!process.env.BOOKSHELV_PUBLIC_URL, instances });
});

federationRoutes.patch('/admin/federation', async c => {
  requireAdmin(c);
  const b = await body(c);
  const name = str(b.name, 80);
  if (name) setSetting('instance_name', name);
  if (b.url !== undefined && !process.env.BOOKSHELV_PUBLIC_URL) {
    const url = normalizeUrl(String(b.url));
    if (!url) throw new HTTPException(400, { message: 'Ungültige Adresse' });
    setSetting('public_url', url);
  }
  return c.json({ ok: true });
});

federationRoutes.post('/admin/federation/link', async c => {
  requireAdmin(c);
  if (!selfUrl()) throw new HTTPException(400, { message: 'Eigene Adresse ist nicht bekannt' });
  const url = normalizeUrl(String((await body(c)).url ?? ''));
  if (!url) throw new HTTPException(400, { message: 'Ungültige Adresse' });
  if (url === selfUrl()) throw new HTTPException(400, { message: 'Das ist diese Instanz' });
  const info = await fetchInfo(url);
  if (!info) throw new HTTPException(502, { message: 'Dort läuft keine erreichbare bookshelv-Instanz' });
  const existing = getInstanceByUrl(url);
  if (existing?.status === 'linked') return c.json({ status: 'linked' });
  if (existing?.status === 'pending_in') {
    // die andere Seite hatte schon angefragt → annehmen
    db.prepare(`UPDATE instances SET status = 'linked', public_key = ?, name = ?, linked_at = datetime('now') WHERE id = ?`).run(info.publicKey, info.name, existing.id);
    enqueue({ type: 'LinkAccept', name: instanceName() }, existing.id);
    backfill(existing.id);
    return c.json({ status: 'linked' });
  }
  db.prepare(`INSERT OR REPLACE INTO instances (id, url, name, public_key, status) VALUES (?, ?, ?, ?, 'pending_out')`)
    .run(existing?.id ?? null, url, info.name, info.publicKey);
  const res = await sendNow(url, '/api/fed/inbox', { type: 'LinkRequest', name: instanceName() });
  if (!res.ok) throw new HTTPException(502, { message: 'Die andere Instanz hat die Anfrage abgelehnt' });
  return c.json({ status: (res.data as { status?: string })?.status === 'linked' ? 'linked' : 'pending_out' });
});

federationRoutes.post('/admin/federation/:id/accept', c => {
  requireAdmin(c);
  const inst = db.prepare(`SELECT * FROM instances WHERE id = ? AND status = 'pending_in'`).get(idParam(c)) as Instance | undefined;
  if (!inst) throw notFound('Eintrag');
  db.prepare(`UPDATE instances SET status = 'linked', linked_at = datetime('now') WHERE id = ?`).run(inst.id);
  enqueue({ type: 'LinkAccept', name: instanceName() }, inst.id);
  backfill(inst.id);
  return c.json({ ok: true });
});

federationRoutes.delete('/admin/federation/:id', async c => {
  requireAdmin(c);
  const inst = db.prepare('SELECT * FROM instances WHERE id = ?').get(idParam(c)) as Instance | undefined;
  if (!inst) throw notFound('Eintrag');
  if (inst.status !== 'pending_in') await sendNow(inst.url, '/api/fed/inbox', { type: 'Unlink' }); // best effort
  unlinkCleanup(inst);
  return c.json({ ok: true });
});

/** Für Nutzer: gekoppelte Instanzen (Auswahl beim Verleihen) */
federationRoutes.get('/federation/instances', c => {
  requireUser(c);
  return c.json(db.prepare(`SELECT id, url, name FROM instances WHERE status = 'linked' ORDER BY name`).all());
});
