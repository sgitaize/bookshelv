import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { db } from './db.ts';
import { config } from './config.ts';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
// N=2^15 → 32 MB pro Hash: sicher genug, aber schonend für Shared Hosting
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const COOKIE = 'bs_session';

export type User = {
  id: number;
  username: string;
  display_name: string;
  is_admin: number;
  shelf_visible: number;
  avatar: string | null;
  created_at: string;
};

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem
  });
  return crypto.timingSafeEqual(expected, actual);
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function validateCredentials(username: unknown, password: unknown): { username: string; password: string } {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(username))
    throw new HTTPException(400, { message: 'Benutzername: 3–32 Zeichen, nur Buchstaben, Ziffern, . _ -' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 200)
    throw new HTTPException(400, { message: 'Passwort: mindestens 8 Zeichen' });
  return { username, password };
}

export function startSession(c: Context, userId: number) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires.toISOString());
  setCookie(c, COOKIE, token, {
    httpOnly: true, secure: config.secureCookies, sameSite: 'Lax', path: '/', expires
  });
}

export function endSession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  deleteCookie(c, COOKIE, { path: '/' });
}

/** Hängt den eingeloggten Nutzer (oder null) an den Kontext. */
export const loadUser: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, COOKIE);
  let user: User | null = null;
  if (token) {
    user = (db.prepare(`
      SELECT u.id, u.username, u.display_name, u.is_admin, u.shelf_visible, u.avatar, u.created_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0
    `).get(sha256(token), new Date().toISOString()) as User | undefined) ?? null;
  }
  c.set('user', user);
  await next();
};

export function requireUser(c: Context): User {
  const user = c.get('user') as User | null;
  if (!user) throw new HTTPException(401, { message: 'Nicht angemeldet' });
  return user;
}

export function requireAdmin(c: Context): User {
  const user = requireUser(c);
  if (!user.is_admin) throw new HTTPException(403, { message: 'Nur für Admins' });
  return user;
}

/** Einfache Bremse gegen Passwort-Raten (pro Prozess; reicht für einen Freundeskreis). */
const failures = new Map<string, { count: number; until: number }>();
export function checkLoginThrottle(key: string) {
  const f = failures.get(key);
  if (f && f.count >= 5 && f.until > Date.now())
    throw new HTTPException(429, { message: 'Zu viele Fehlversuche – bitte in ein paar Minuten erneut versuchen' });
}
export function recordLoginFailure(key: string) {
  const f = failures.get(key) ?? { count: 0, until: 0 };
  f.count++;
  f.until = Date.now() + 5 * 60_000;
  failures.set(key, f);
}
export function clearLoginFailures(key: string) {
  failures.delete(key);
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}
