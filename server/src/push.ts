/**
 * Web Push (PWA im Browser) ohne Abhängigkeiten: VAPID (RFC 8292) mit ES256 aus node:crypto, Nachrichten ohne Nutzlast.
 * Der Push sagt nur „es gibt Neues“ – der Service Worker holt die Zahl selbst ab, persönliche Daten gehen nie
 * über den Push-Dienst. Opt-in je Gerät (Einstellungen → Benachrichtigungen), Abmelden löscht das Abo.
 *
 * Zustellung an alle Abos einer Person, sobald notify() eine In-App-Benachrichtigung anlegt (z. B. neue Meldung für Admins).
 * 404/410 vom Push-Dienst = Abo abgelaufen → gelöscht. APNs/FCM für die nativen Apps kommen als weitere Zusteller hinzu.
 *
 * Schutz vor SSRF: Endpunkte nur per https bei bekannten Push-Diensten (BOOKSHELV_PUSH_ALLOW_HTTP=1 für Tests auf localhost).
 */
import crypto from 'node:crypto';
import { db } from './db.ts';
import { config } from './config.ts';
import { setting, setSetting, selfUrl } from './federation.ts';
import { operator } from './routes/admin.ts';

const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const MAX_PER_USER = 10;

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** VAPID-Schlüssel beim ersten Bedarf erzeugen; öffentlich = unkomprimierter P-256-Punkt (65 Byte) als base64url */
function vapid(): { publicKey: string; privateKey: crypto.KeyObject } {
  let pem = setting('vapid_private');
  if (!pem) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    setSetting('vapid_private', pem);
  }
  const privateKey = crypto.createPrivateKey(pem);
  const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' }) as { x: string; y: string };
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { publicKey: b64url(point), privateKey };
}

export const pushAvailable = () => !config.local;
export const vapidPublicKey = () => vapid().publicKey;

export function validEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 1000) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (process.env.BOOKSHELV_PUSH_ALLOW_HTTP === '1' && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return u.href;
  if (u.protocol !== 'https:' || u.port || u.username) return null;
  return PUSH_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h)) ? u.href : null;
}

export function subscribe(userId: number, endpoint: string) {
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint) VALUES (?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, created_at = datetime('now')`).run(userId, endpoint);
  // älteste Geräte zuerst wegräumen
  db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ${MAX_PER_USER})`).run(userId, userId);
}

export const unsubscribe = (userId: number, endpoint: string) =>
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint).changes > 0;

/** sub-Claim: Kontakt für den Push-Dienst (öffentliche URL der Instanz oder E-Mail aus dem Impressum) */
function contact() {
  const url = selfUrl();
  if (url?.startsWith('https://')) return url;
  const mail = operator().email;
  return mail ? `mailto:${mail}` : 'https://github.com/sgitaize/bookshelv';
}

function jwt(audience: string, key: crypto.KeyObject) {
  const enc = (o: object) => b64url(Buffer.from(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact() })}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${b64url(sig)}`;
}

/** Leeren Push an alle Geräte einer Person; Fehler nur protokollieren (Benachrichtigung in der App gibt es ja trotzdem) */
export async function pushTo(userId: number) {
  if (!pushAvailable()) return;
  const subs = db.prepare('SELECT id, endpoint FROM push_subscriptions WHERE user_id = ?').all(userId) as { id: number; endpoint: string }[];
  if (!subs.length) return;
  const { publicKey, privateKey } = vapid();
  await Promise.all(subs.map(async s => {
    if (!validEndpoint(s.endpoint)) return;
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { Authorization: `vapid t=${jwt(new URL(s.endpoint).origin, privateKey)}, k=${publicKey}`, TTL: '86400', Urgency: 'normal', 'Content-Length': '0' },
        signal: AbortSignal.timeout(10_000)
      });
      if (res.status === 404 || res.status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      else if (res.ok) db.prepare("UPDATE push_subscriptions SET last_ok = datetime('now') WHERE id = ?").run(s.id);
      else console.error(`Push ${new URL(s.endpoint).host}: HTTP ${res.status}`);
    } catch (e) {
      console.error(`Push ${new URL(s.endpoint).host}: ${(e as Error).message}`);
    }
  }));
}
