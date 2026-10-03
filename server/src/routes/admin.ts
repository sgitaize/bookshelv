import fs from 'node:fs';
import path from 'node:path';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { config } from '../config.ts';
import { requireAdmin, hashPassword, randomToken } from '../auth.ts';
import { deleteCoverFile, prunePreviews, dnbGenres } from '../catalog.ts';
import { router, body, idParam, notFound } from '../util.ts';
import { anonymizeBorrower } from './loans.ts';
import { purgeAvatar } from './social.ts';
import { retractFederatedReviews } from './reviews.ts';

export const adminRoutes = router();

const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

adminRoutes.get('/stats', c => {
  requireAdmin(c);
  const dbFile = path.join(config.dataDir, 'bookshelv.db');
  const coverBytes = fs.readdirSync(path.join(config.dataDir, 'covers'), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).reduce((a, e) => a + fs.statSync(path.join(e.parentPath, e.name)).size, 0);
  return c.json({
    users: count('SELECT COUNT(*) AS n FROM users'),
    books: count('SELECT COUNT(*) AS n FROM books'),
    copies: count('SELECT COUNT(*) AS n FROM copies WHERE removed_at IS NULL'),
    reviews: count('SELECT COUNT(*) AS n FROM reviews'),
    openLoans: count('SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL'),
    orphanBooks: count('SELECT COUNT(*) AS n FROM books b WHERE NOT EXISTS (SELECT 1 FROM copies WHERE book_id = b.id) AND NOT EXISTS (SELECT 1 FROM reviews WHERE book_id = b.id)'),
    dbBytes: fs.statSync(dbFile).size,
    coverBytes,
    version: config.version,
    node: process.version
  });
});

adminRoutes.get('/users', c => {
  requireAdmin(c);
  return c.json(db.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName, u.is_admin AS isAdmin, u.disabled, u.created_at AS createdAt, u.avatar IS NOT NULL AS hasAvatar,
           inv.display_name AS invitedBy,
           (SELECT COUNT(*) FROM copies WHERE owner_id = u.id AND removed_at IS NULL) AS copies,
           (SELECT MAX(created_at) FROM sessions WHERE user_id = u.id) AS lastLogin
    FROM users u LEFT JOIN users inv ON inv.id = u.invited_by ORDER BY u.id
  `).all().map(r => ({ ...r, isAdmin: !!r.isAdmin, disabled: !!r.disabled, hasAvatar: !!r.hasAvatar })));
});

adminRoutes.patch('/users/:id', async c => {
  const me = requireAdmin(c);
  const id = idParam(c);
  const b = await body(c);
  if (id === me.id && (b.isAdmin === false || b.disabled === true))
    throw new HTTPException(400, { message: 'Du kannst dich nicht selbst entmachten oder sperren' });
  if (typeof b.isAdmin === 'boolean') db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(b.isAdmin ? 1 : 0, id);
  if (typeof b.disabled === 'boolean') {
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(b.disabled ? 1 : 0, id);
    if (b.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  return c.json({ ok: true });
});

/** Ohne E-Mail gibt es kein "Passwort vergessen" – der Admin setzt ein Einmal-Passwort und gibt es weiter */
adminRoutes.post('/users/:id/reset-password', async c => {
  requireAdmin(c);
  const id = idParam(c);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound('Konto');
  const password = randomToken(9);
  db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(await hashPassword(password), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  return c.json({ password });
});

adminRoutes.delete('/users/:id', c => {
  const me = requireAdmin(c);
  const id = idParam(c);
  if (id === me.id) throw new HTTPException(400, { message: 'Eigenes Konto bitte über die Einstellungen löschen' });
  anonymizeBorrower(id);
  purgeAvatar(id);
  retractFederatedReviews(id);
  if (!db.prepare('DELETE FROM users WHERE id = ?').run(id).changes) throw notFound('Konto');
  return c.json({ ok: true });
});

adminRoutes.get('/invites', c => {
  requireAdmin(c);
  return c.json(db.prepare(`
    SELECT i.id, i.token, i.note, i.created_at AS createdAt, i.expires_at AS expiresAt, i.used_at AS usedAt,
           cr.display_name AS createdBy, us.display_name AS usedBy
    FROM invites i JOIN users cr ON cr.id = i.created_by LEFT JOIN users us ON us.id = i.used_by
    ORDER BY i.id DESC LIMIT 200
  `).all());
});

adminRoutes.delete('/stores/:id', c => {
  requireAdmin(c);
  if (!db.prepare('DELETE FROM stores WHERE id = ?').run(idParam(c)).changes) throw notFound('Eintrag');
  return c.json({ ok: true });
});

/** Aufräumen: Katalogeinträge ohne Exemplar/Review, abgelaufene Einladungen, alte Vorschaubilder */
adminRoutes.post('/cleanup', c => {
  requireAdmin(c);
  const orphans = db.prepare(`
    SELECT id, cover FROM books b WHERE NOT EXISTS (SELECT 1 FROM copies WHERE book_id = b.id)
      AND NOT EXISTS (SELECT 1 FROM reviews WHERE book_id = b.id)
  `).all() as { id: number; cover: string | null }[];
  for (const o of orphans) {
    db.prepare('DELETE FROM books WHERE id = ?').run(o.id);
    deleteCoverFile(o.cover);
  }
  const invites = db.prepare('DELETE FROM invites WHERE used_by IS NULL AND expires_at <= ?').run(new Date().toISOString()).changes;
  prunePreviews(0);
  db.exec('VACUUM');
  return c.json({ books: orphans.length, invites: Number(invites) });
});

/** Genres für vorhandene Bücher aus dem DNB-MARC-Datensatz nachladen (nacheinander, um die DNB zu schonen) */
adminRoutes.post('/refresh-genres', async c => {
  requireAdmin(c);
  const books = db.prepare('SELECT id, isbn13, subjects FROM books WHERE isbn13 IS NOT NULL').all() as { id: number; isbn13: string; subjects: string }[];
  let updated = 0;
  for (const b of books) {
    const genres = await dnbGenres(b.isbn13);
    if (!genres.length) continue;
    const old = JSON.parse(b.subjects) as string[];
    const merged = [...new Set([...genres, ...old])].slice(0, 15);
    if (JSON.stringify(merged) !== b.subjects) {
      db.prepare('UPDATE books SET subjects = ? WHERE id = ?').run(JSON.stringify(merged), b.id);
      updated++;
    }
  }
  return c.json({ books: books.length, updated });
});
