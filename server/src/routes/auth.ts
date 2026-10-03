import fs from 'node:fs';
import path from 'node:path';
import { HTTPException } from 'hono/http-exception';
import { db, tx } from '../db.ts';
import { config } from '../config.ts';
import {
  hashPassword, verifyPassword, validateCredentials, startSession, endSession, requireUser,
  checkLoginThrottle, recordLoginFailure, clearLoginFailures, randomToken, type User
} from '../auth.ts';
import { router, body, str, idParam, notFound } from '../util.ts';
import { anonymizeBorrower } from './loans.ts';
import { notify } from '../notify.ts';
import { avatarUrl, purgeAvatar } from './social.ts';
import { retractFederatedReviews } from './reviews.ts';

export const authRoutes = router();

const setupFile = path.join(config.dataDir, 'setup-token.txt');
const userCount = () => (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;

/**
 * Beim ersten Start gibt es noch keinen Admin. Damit nicht jeder Fremde, der zufällig zuerst die Seite öffnet,
 * Admin wird, liegt ein Einmal-Token in data/setup-token.txt (per SSH/FTP lesbar).
 */
export function ensureSetupToken() {
  if (userCount() > 0) {
    fs.rmSync(setupFile, { force: true });
    return;
  }
  if (!fs.existsSync(setupFile)) fs.writeFileSync(setupFile, randomToken(12) + '\n', { mode: 0o600 });
  console.log(`bookshelv: Ersteinrichtung offen – Setup-Token steht in ${setupFile}`);
}

const publicUser = (u: User) => ({
  id: u.id, username: u.username, displayName: u.display_name, isAdmin: !!u.is_admin,
  shelfVisible: !!u.shelf_visible, createdAt: u.created_at, avatarUrl: avatarUrl(u.avatar), prefs: parsePrefs(u.prefs)
});

const THEMES = ['night', 'light', 'paper', 'ink', 'forest', 'rose', 'system'];
const FONTS = ['typewriter', 'modern'];
function parsePrefs(raw: string | undefined) {
  try { return JSON.parse(raw || '{}') as Record<string, string>; } catch { return {}; }
}

authRoutes.get('/status', c => c.json({
  needsSetup: userCount() === 0, version: config.version, node: process.version
}));

authRoutes.post('/setup', async c => {
  const b = await body(c);
  if (userCount() > 0) throw new HTTPException(409, { message: 'Bereits eingerichtet' });
  const expected = fs.existsSync(setupFile) ? fs.readFileSync(setupFile, 'utf8').trim() : null;
  if (!expected || b.token !== expected) throw new HTTPException(403, { message: 'Setup-Token falsch' });
  const { username, password } = validateCredentials(b.username, b.password);
  const hash = await hashPassword(password);
  const id = Number(db.prepare('INSERT INTO users (username, display_name, pw_hash, is_admin) VALUES (?, ?, ?, 1)')
    .run(username, str(b.displayName, 60) ?? username, hash).lastInsertRowid);
  fs.rmSync(setupFile, { force: true });
  startSession(c, id);
  return c.json({ ok: true });
});

authRoutes.post('/login', async c => {
  const b = await body(c);
  const ip = c.req.header('x-forwarded-for')?.split(',')[0] ?? 'local';
  const key = `${ip}|${String(b.username).toLowerCase()}`;
  checkLoginThrottle(key);
  const row = db.prepare('SELECT id, pw_hash, disabled FROM users WHERE username = ?').get(String(b.username ?? '')) as
    { id: number; pw_hash: string; disabled: number } | undefined;
  const ok = row && !row.disabled && typeof b.password === 'string' && await verifyPassword(b.password, row.pw_hash);
  if (!ok) {
    recordLoginFailure(key);
    throw new HTTPException(401, { message: 'Anmeldename oder Passwort falsch' });
  }
  clearLoginFailures(key);
  startSession(c, row.id);
  return c.json({ ok: true });
});

authRoutes.post('/logout', c => {
  endSession(c);
  return c.json({ ok: true });
});

authRoutes.get('/me', c => c.json(publicUser(requireUser(c))));

authRoutes.patch('/me', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const name = str(b.displayName, 60);
  if (name) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, u.id);
  if (b.prefs && typeof b.prefs === 'object') {
    const p = b.prefs as Record<string, unknown>;
    const next = parsePrefs(u.prefs);
    if (typeof p.theme === 'string' && THEMES.includes(p.theme)) next.theme = p.theme;
    if (typeof p.font === 'string' && FONTS.includes(p.font)) next.font = p.font;
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(next), u.id);
  }
  if (typeof b.shelfVisible === 'boolean') db.prepare('UPDATE users SET shelf_visible = ? WHERE id = ?').run(b.shelfVisible ? 1 : 0, u.id);
  return c.json({ ok: true });
});

authRoutes.post('/me/password', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const row = db.prepare('SELECT pw_hash FROM users WHERE id = ?').get(u.id) as { pw_hash: string };
  if (typeof b.current !== 'string' || !await verifyPassword(b.current, row.pw_hash))
    throw new HTTPException(403, { message: 'Aktuelles Passwort falsch' });
  const { password } = validateCredentials(u.username, b.password);
  db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(await hashPassword(password), u.id);
  // andere Geräte abmelden, aktuelle Sitzung neu starten
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  startSession(c, u.id);
  return c.json({ ok: true });
});

/** DSGVO Art. 15/20: alle eigenen Daten als JSON */
authRoutes.get('/me/export', c => {
  const u = requireUser(c);
  const data = {
    exportedAt: new Date().toISOString(),
    user: publicUser(u),
    copies: db.prepare(`SELECT c.*, b.isbn13, b.title, b.authors FROM copies c JOIN books b ON b.id = c.book_id WHERE c.owner_id = ?`).all(u.id),
    reading: db.prepare(`SELECT ub.*, b.isbn13, b.title FROM user_books ub JOIN books b ON b.id = ub.book_id WHERE ub.user_id = ?`).all(u.id),
    reviews: db.prepare(`SELECT r.*, b.title FROM reviews r JOIN books b ON b.id = r.book_id WHERE r.user_id = ?`).all(u.id),
    comments: db.prepare('SELECT * FROM comments WHERE user_id = ?').all(u.id),
    loans: db.prepare('SELECT * FROM loans WHERE lender_id = ? OR borrower_id = ?').all(u.id, u.id),
    wishlist: db.prepare('SELECT w.*, b.isbn13, b.title FROM wishlist w JOIN books b ON b.id = w.book_id WHERE w.user_id = ?').all(u.id),
    lists: db.prepare('SELECT * FROM lists WHERE user_id = ?').all(u.id).map(l => ({
      ...l, items: db.prepare('SELECT li.*, b.isbn13, b.title FROM list_items li JOIN books b ON b.id = li.book_id WHERE li.list_id = ? ORDER BY li.position').all(l.id as number)
    })),
    invites: db.prepare('SELECT token, note, created_at, expires_at, used_at FROM invites WHERE created_by = ?').all(u.id)
  };
  c.header('Content-Disposition', `attachment; filename="bookshelv-${u.username}.json"`);
  return c.json(data);
});

/** DSGVO Art. 17: Konto samt aller Daten löschen */
authRoutes.delete('/me', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const row = db.prepare('SELECT pw_hash FROM users WHERE id = ?').get(u.id) as { pw_hash: string };
  if (typeof b.password !== 'string' || !await verifyPassword(b.password, row.pw_hash))
    throw new HTTPException(403, { message: 'Passwort falsch' });
  if (u.is_admin && (db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get() as { n: number }).n === 1)
    throw new HTTPException(409, { message: 'Du bist der einzige Admin – ernenne zuerst einen anderen Admin' });
  endSession(c);
  anonymizeBorrower(u.id);
  purgeAvatar(u.id);
  retractFederatedReviews(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  return c.json({ ok: true });
});

// ---------- Einladungen ----------

authRoutes.get('/invites', c => {
  const u = requireUser(c);
  return c.json(db.prepare(`
    SELECT i.id, i.token, i.note, i.created_at AS createdAt, i.expires_at AS expiresAt, i.used_at AS usedAt,
           u.display_name AS usedBy
    FROM invites i LEFT JOIN users u ON u.id = i.used_by
    WHERE i.created_by = ? ORDER BY i.id DESC LIMIT 50
  `).all(u.id));
});

authRoutes.post('/invites', async c => {
  const u = requireUser(c);
  const b = await body(c);
  const open = (db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE created_by = ? AND used_by IS NULL AND expires_at > ?`)
    .get(u.id, new Date().toISOString()) as { n: number }).n;
  if (!u.is_admin && open >= 10) throw new HTTPException(429, { message: 'Höchstens 10 offene Einladungen' });
  const token = randomToken(18);
  const expires = new Date(Date.now() + config.inviteDays * 86400_000).toISOString();
  db.prepare('INSERT INTO invites (token, created_by, note, expires_at) VALUES (?, ?, ?, ?)').run(token, u.id, str(b.note, 100), expires);
  return c.json({ token, expiresAt: expires });
});

authRoutes.delete('/invites/:id', c => {
  const u = requireUser(c);
  const r = db.prepare('DELETE FROM invites WHERE id = ? AND used_by IS NULL AND (created_by = ? OR ?)')
    .run(idParam(c), u.id, u.is_admin ? 1 : 0);
  if (!r.changes) throw notFound('Einladung');
  return c.json({ ok: true });
});

const findInvite = (token: string) => db.prepare(`
  SELECT i.id, u.display_name AS invitedBy, i.created_by AS createdBy FROM invites i JOIN users u ON u.id = i.created_by
  WHERE i.token = ? AND i.used_by IS NULL AND i.expires_at > ?
`).get(token, new Date().toISOString()) as { id: number; invitedBy: string; createdBy: number } | undefined;

authRoutes.get('/invites/check/:token', c => {
  const inv = findInvite(c.req.param('token'));
  return c.json(inv ? { valid: true, invitedBy: inv.invitedBy } : { valid: false });
});

authRoutes.post('/register', async c => {
  const b = await body(c);
  const { username, password } = validateCredentials(b.username, b.password);
  const hash = await hashPassword(password);
  const id = tx(() => {
    const inv = findInvite(String(b.token ?? ''));
    if (!inv) throw new HTTPException(403, { message: 'Einladung ungültig oder abgelaufen' });
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username))
      throw new HTTPException(409, { message: 'Anmeldename ist schon vergeben' });
    const id = Number(db.prepare('INSERT INTO users (username, display_name, pw_hash, invited_by) VALUES (?, ?, ?, ?)')
      .run(username, str(b.displayName, 60) ?? username, hash, inv.createdBy).lastInsertRowid);
    db.prepare(`UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE id = ?`).run(id, inv.id);
    notify(inv.createdBy, 'invite_accepted', id);
    return id;
  });
  startSession(c, id);
  return c.json({ ok: true });
});
