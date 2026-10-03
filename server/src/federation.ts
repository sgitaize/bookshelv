/**
 * Föderation – Kern: Instanz-Identität (Ed25519), signierte Nachrichten, Zustellwarteschlange.
 *
 * Protokoll: POST <andere Instanz>/api/fed/inbox mit JSON-Body und den Headern
 *   x-bs-origin    URL der sendenden Instanz (z. B. https://books.example.org)
 *   x-bs-date      Zeitpunkt (ISO), max. 5 Minuten Abweichung
 *   x-bs-signature base64(Ed25519-Signatur über "<date>\n<sha256(body)>")
 * Angenommen wird nur von gekoppelten Instanzen (Ausnahme: die Kopplungsanfrage selbst).
 */
import crypto from 'node:crypto';
import { db } from './db.ts';
import { config } from './config.ts';

// ---------- Einstellungen / eigene Identität ----------

export function setting(key: string): string | null {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}
export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Schlüsselpaar beim ersten Bedarf erzeugen und in der DB ablegen */
function keys() {
  let priv = setting('fed_private_key');
  let pub = setting('fed_public_key');
  if (!priv || !pub) {
    const kp = crypto.generateKeyPairSync('ed25519');
    priv = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    pub = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    setSetting('fed_private_key', priv);
    setSetting('fed_public_key', pub);
  }
  return { priv, pub };
}
export const publicKey = () => keys().pub;

/**
 * Eigene öffentliche URL: BOOKSHELV_PUBLIC_URL, sonst beim ersten Admin-Aufruf aus Host/Proto gemerkt.
 * Ohne bekannte URL kann nicht föderiert werden.
 */
export function selfUrl(): string | null {
  return process.env.BOOKSHELV_PUBLIC_URL?.replace(/\/$/, '') ?? setting('public_url');
}
export function rememberSelfUrl(url: string) {
  if (!process.env.BOOKSHELV_PUBLIC_URL && !setting('public_url')) setSetting('public_url', url.replace(/\/$/, ''));
}
export const instanceName = () => setting('instance_name') ?? 'bookshelv';

/** Nur https (http nur zum lokalen Testen per BOOKSHELV_FED_ALLOW_HTTP=1), keine Pfade/Credentials */
export function normalizeUrl(input: string): string | null {
  try {
    const u = new URL(input.trim().includes('://') ? input.trim() : `https://${input.trim()}`);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && process.env.BOOKSHELV_FED_ALLOW_HTTP === '1')) return null;
    if (u.username || u.password) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// ---------- Signaturen ----------

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function signedHeaders(body: string): Record<string, string> {
  const date = new Date().toISOString();
  const sig = crypto.sign(null, Buffer.from(`${date}\n${sha256(body)}`), keys().priv).toString('base64');
  return { 'content-type': 'application/json', 'x-bs-origin': selfUrl() ?? '', 'x-bs-date': date, 'x-bs-signature': sig, 'user-agent': config.userAgent };
}

export function verify(body: string, date: string | undefined, signature: string | undefined, pem: string): boolean {
  if (!date || !signature) return false;
  const t = Date.parse(date);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 5 * 60_000) return false;
  try {
    return crypto.verify(null, Buffer.from(`${date}\n${sha256(body)}`), pem, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

// ---------- Versand ----------

export type Instance = { id: number; url: string; name: string | null; public_key: string; status: string };

/** Direkt senden (für Kopplung/Nachschlagen, wo eine Antwort gebraucht wird) */
export async function sendNow(url: string, path: string, payload: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const body = JSON.stringify(payload);
  try {
    const res = await fetch(`${url}${path}`, { method: 'POST', headers: signedHeaders(body), body, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* leer */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** Info-Dokument einer anderen Instanz abrufen */
export async function fetchInfo(url: string): Promise<{ name: string; publicKey: string; url: string } | null> {
  try {
    const res = await fetch(`${url}/api/fed/info`, { signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { 'user-agent': config.userAgent } });
    if (!res.ok) return null;
    const j = await res.json() as { software?: string; name?: string; publicKey?: string; url?: string };
    if (j.software !== 'bookshelv' || typeof j.publicKey !== 'string') return null;
    return { name: String(j.name ?? url), publicKey: j.publicKey, url: normalizeUrl(String(j.url ?? url)) ?? url };
  } catch {
    return null;
  }
}

/** An eine oder alle gekoppelten Instanzen einreihen; Zustellung asynchron mit Wiederholung */
export function enqueue(payload: unknown, instanceId?: number) {
  const targets = instanceId
    ? [instanceId]
    : (db.prepare(`SELECT id FROM instances WHERE status = 'linked'`).all() as { id: number }[]).map(r => r.id);
  const body = JSON.stringify(payload);
  for (const id of targets) db.prepare('INSERT INTO outbox (instance_id, body) VALUES (?, ?)').run(id, body);
  if (targets.length) setImmediate(() => { deliver().catch(() => {}); });
}

let delivering = false;
// Wartezeiten nach Fehlversuchen: 1 min, 5 min, 30 min, 2 h, 6 h, dann alle 12 h – nach 3 Tagen aufgeben
const BACKOFF_MIN = [1, 5, 30, 120, 360, 720];

export async function deliver() {
  if (delivering || !selfUrl()) return;
  delivering = true;
  try {
    const due = db.prepare(`
      SELECT o.id, o.body, o.attempts, o.created_at, i.url FROM outbox o JOIN instances i ON i.id = o.instance_id
      WHERE i.status = 'linked' AND o.next_at <= datetime('now') ORDER BY o.id LIMIT 50
    `).all() as { id: number; body: string; attempts: number; created_at: string; url: string }[];
    for (const m of due) {
      let ok = false;
      try {
        const res = await fetch(`${m.url}/api/fed/inbox`, { method: 'POST', headers: signedHeaders(m.body), body: m.body, signal: AbortSignal.timeout(10_000), redirect: 'error' });
        // 4xx (außer 429) = dauerhaft abgelehnt → nicht endlos wiederholen
        ok = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);
      } catch { /* Netzwerkfehler → später erneut */ }
      const age = Date.now() - Date.parse(m.created_at.replace(' ', 'T') + 'Z');
      if (ok || age > 3 * 86400_000) db.prepare('DELETE FROM outbox WHERE id = ?').run(m.id);
      else {
        const wait = BACKOFF_MIN[Math.min(m.attempts, BACKOFF_MIN.length - 1)];
        db.prepare(`UPDATE outbox SET attempts = attempts + 1, next_at = datetime('now', ?) WHERE id = ?`).run(`+${wait} minutes`, m.id);
      }
    }
  } finally {
    delivering = false;
  }
}

/** Unter Passenger schlafen Prozesse – daher Timer UND Anstoß bei eingehenden Anfragen */
let lastKick = 0;
export function kickDelivery() {
  if (Date.now() - lastKick < 20_000) return;
  lastKick = Date.now();
  setImmediate(() => { deliver().catch(() => {}); });
}

// ---------- Entfernte Personen ----------

export function upsertActor(instanceId: number, a: { id: number; username: string; displayName: string }): number {
  db.prepare(`
    INSERT INTO remote_actors (instance_id, remote_id, username, display_name) VALUES (?, ?, ?, ?)
    ON CONFLICT (instance_id, remote_id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, updated_at = datetime('now')
  `).run(instanceId, a.id, String(a.username).slice(0, 32), String(a.displayName).slice(0, 60));
  return (db.prepare('SELECT id FROM remote_actors WHERE instance_id = ? AND remote_id = ?').get(instanceId, a.id) as { id: number }).id;
}

/** "@anna@books.example.org" → Handle-Teile */
export function parseHandle(h: string): { username: string; host: string } | null {
  const m = h.trim().match(/^@?([a-zA-Z0-9._-]{3,32})@([a-z0-9.-]+(?::\d+)?)$/i);
  return m ? { username: m[1], host: m[2].toLowerCase() } : null;
}

export const handleOf = (username: string, instanceUrl: string) => `@${username}@${new URL(instanceUrl).host}`;
