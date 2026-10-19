/**
 * Push über andere Apps – funktioniert auch für die iOS- und Android-App (deren WebView kann kein Web Push)
 * und ohne Apple-/Google-Push-Dienste:
 *   ntfy      Thema-URL (ntfy.sh oder selbst gehostet), die Person abonniert das Thema in der ntfy-App
 *   Pushover  Benutzerschlüssel der Person; den App-Token trägt die betreibende Person ein (Admin → Instanz)
 *   Telegram  Bot der Instanz (Token im Admin-Bereich); Kopplung per Link t.me/<bot>?start=<code>
 *
 * Inhalt bewusst ohne persönliche Daten („bookshelv: 2 neue Benachrichtigungen“ + Link) – ntfy-Themen sind öffentlich.
 * Höchstens eine Nachricht je Dienst und 30 Sekunden; was dazwischen passiert, steht ja in der Glocke.
 */
import crypto from 'node:crypto';
import { db } from './db.ts';
import { config } from './config.ts';
import { setting, setSetting, selfUrl } from './federation.ts';

export type ChannelKind = 'ntfy' | 'pushover' | 'telegram';
type Row = { user_id: number; kind: ChannelKind; target: string; lang: string; last_sent: number | null };

const QUIET_MS = 30_000;
// nur für Tests überschreibbar
const PUSHOVER_API = process.env.BOOKSHELV_PUSHOVER_API ?? 'https://api.pushover.net/1/messages.json';
const TELEGRAM_API = process.env.BOOKSHELV_TELEGRAM_API ?? 'https://api.telegram.org';

/** Zugangsdaten der betreibenden Person: Umgebungsvariable vor Admin-Einstellung */
export const pushoverToken = () => process.env.BOOKSHELV_PUSHOVER_TOKEN || setting('pushover_token');
export const telegramToken = () => process.env.BOOKSHELV_TELEGRAM_BOT_TOKEN || setting('telegram_token');

const allowHttp = () => process.env.BOOKSHELV_PUSH_ALLOW_HTTP === '1';

/**
 * ntfy-Thema prüfen: https, Hostname (keine IP-Adresse, kein localhost – sonst könnte man den Server interne Adressen
 * aufrufen lassen), genau ein Pfadteil als Thema. BOOKSHELV_NTFY_HOSTS schränkt auf bestimmte Server ein.
 */
export function validNtfy(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const topic = u.pathname.replace(/^\/|\/$/g, '');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(topic) || u.search || u.hash || u.username || u.password) return null;
  if (allowHttp() && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return `${u.origin}/${topic}`;
  if (u.protocol !== 'https:' || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  const allowed = (process.env.BOOKSHELV_NTFY_HOSTS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(host)) return null;
  return `https://${host}/${topic}`;
}

export const validPushoverKey = (raw: unknown) => (typeof raw === 'string' && /^[A-Za-z0-9]{30}$/.test(raw.trim()) ? raw.trim() : null);

export function setChannel(userId: number, kind: ChannelKind, target: string, lang: string) {
  db.prepare(`INSERT INTO push_channels (user_id, kind, target, lang) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, kind) DO UPDATE SET target = excluded.target, lang = excluded.lang, last_sent = NULL, last_ok = NULL`)
    .run(userId, kind, target, lang === 'en' ? 'en' : 'de');
}
export const removeChannel = (userId: number, kind: ChannelKind) =>
  db.prepare('DELETE FROM push_channels WHERE user_id = ? AND kind = ?').run(userId, kind);

export function channelsOf(userId: number) {
  return (db.prepare('SELECT kind, target, last_ok AS lastOk FROM push_channels WHERE user_id = ? ORDER BY kind').all(userId) as
    { kind: ChannelKind; target: string; lastOk: string | null }[]).map(c => ({
    kind: c.kind, lastOk: c.lastOk,
    pending: c.target.startsWith('pending:'),
    // Pushover-Schlüssel nur gekürzt zurückgeben, Telegram-Chat-ID gar nicht
    target: c.kind === 'ntfy' ? c.target : c.kind === 'pushover' ? `${c.target.slice(0, 4)}…${c.target.slice(-3)}` : null
  }));
}

const unread = (userId: number) =>
  (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { n: number }).n;

function message(lang: string, n: number, test: boolean) {
  const de = lang !== 'en';
  if (test) return de ? 'Test: So sehen Benachrichtigungen von bookshelv aus.' : 'Test: this is how bookshelv notifications look.';
  if (n > 1) return de ? `${n} neue Benachrichtigungen` : `${n} new notifications`;
  return de ? 'Neue Benachrichtigung' : 'New notification';
}

async function post(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, method: 'POST', signal: AbortSignal.timeout(10_000) });
  return res;
}

/** Eine Nachricht an einen Dienst; true = zugestellt. Dauerhaft ungültige Ziele werden entfernt. */
async function send(r: Row, text: string): Promise<boolean> {
  const link = selfUrl() ? `${selfUrl()}/notifications` : null;
  try {
    if (r.kind === 'ntfy') {
      const res = await post(r.target, { body: text, headers: { Title: 'bookshelv', Tags: 'books', ...(link ? { Click: link } : {}) } });
      return res.ok;
    }
    if (r.kind === 'pushover') {
      const token = pushoverToken();
      if (!token) return false;
      const form = new URLSearchParams({ token, user: r.target, title: 'bookshelv', message: text, ...(link ? { url: link, url_title: 'bookshelv' } : {}) });
      const res = await post(PUSHOVER_API, { body: form });
      // 4xx: Schlüssel ungültig/gelöscht → Kanal entfernen
      if (res.status >= 400 && res.status < 500) removeChannel(r.user_id, 'pushover');
      return res.ok;
    }
    const token = telegramToken();
    if (!token || r.target.startsWith('pending:')) return false;
    const res = await post(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: r.target, text: link ? `bookshelv: ${text}\n${link}` : `bookshelv: ${text}`, disable_web_page_preview: true })
    });
    // 403: Bot blockiert oder Chat gelöscht
    if (res.status === 403 || res.status === 400) removeChannel(r.user_id, 'telegram');
    return res.ok;
  } catch (e) {
    console.error(`Push ${r.kind}: ${(e as Error).message}`);
    return false;
  }
}

/** Neue Benachrichtigung → alle eingerichteten Dienste der Person (nach der Ruhezeit) */
export async function notifyChannels(userId: number, test = false) {
  if (config.local) return [];
  const rows = db.prepare('SELECT user_id, kind, target, lang, last_sent FROM push_channels WHERE user_id = ?').all(userId) as Row[];
  const now = Date.now();
  const due = rows.filter(r => test || !r.last_sent || now - r.last_sent > QUIET_MS);
  if (!due.length) return [];
  const n = unread(userId);
  const mark = db.prepare('UPDATE push_channels SET last_sent = ? WHERE user_id = ? AND kind = ?');
  // eine Testnachricht startet keine Ruhezeit (sonst ginge die nächste echte Benachrichtigung verloren)
  if (!test) for (const r of due) mark.run(now, r.user_id, r.kind);
  return Promise.all(due.map(async r => {
    const ok = await send(r, message(r.lang, n, test));
    if (ok) db.prepare("UPDATE push_channels SET last_ok = datetime('now') WHERE user_id = ? AND kind = ?").run(r.user_id, r.kind);
    return { kind: r.kind, ok };
  }));
}

// ---------- Telegram: Bot-Name und Kopplung ----------

let botCache: { token: string; username: string | null } | null = null;

/** Benutzername des Bots (für den Link), null = Token ungültig/kein Bot */
export async function telegramBot(): Promise<string | null> {
  const token = telegramToken();
  if (!token) return null;
  if (botCache?.token === token) return botCache.username;
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/getMe`, { signal: AbortSignal.timeout(8000) });
    const j = await res.json() as { ok: boolean; result?: { username?: string } };
    botCache = { token, username: j.ok ? j.result?.username ?? null : null };
  } catch { return null; }
  return botCache.username;
}

/** Kopplungscode erzeugen; die Person öffnet t.me/<bot>?start=<code> und tippt „Start“ */
export function telegramLinkCode(userId: number, lang: string) {
  const code = crypto.randomBytes(9).toString('base64url');
  setChannel(userId, 'telegram', `pending:${code}`, lang);
  return code;
}

/**
 * Neue Nachrichten an den Bot abholen (getUpdates, kein Webhook nötig) und „/start <code>“ den wartenden Kopplungen zuordnen.
 * Läuft, wenn jemand in den Einstellungen auf „Verbunden?“ tippt.
 */
export async function telegramPoll() {
  const token = telegramToken();
  if (!token) return;
  const offset = Number(setting('telegram_offset') ?? 0);
  const res = await fetch(`${TELEGRAM_API}/bot${token}/getUpdates?timeout=0&allowed_updates=%5B%22message%22%5D${offset ? `&offset=${offset}` : ''}`,
    { signal: AbortSignal.timeout(10_000) });
  const j = await res.json() as { ok: boolean; result?: { update_id: number; message?: { text?: string; chat?: { id: number } } }[] };
  if (!j.ok || !j.result?.length) return;
  for (const up of j.result) {
    const m = up.message?.text?.match(/^\/start\s+([A-Za-z0-9_-]{6,64})$/);
    const chat = up.message?.chat?.id;
    if (!m || !chat) continue;
    const row = db.prepare("SELECT user_id, lang FROM push_channels WHERE kind = 'telegram' AND target = ?").get(`pending:${m[1]}`) as { user_id: number; lang: string } | undefined;
    if (!row) continue;
    db.prepare("UPDATE push_channels SET target = ? WHERE user_id = ? AND kind = 'telegram'").run(String(chat), row.user_id);
    await post(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: row.lang === 'en' ? 'bookshelv is connected. You will get a short note here when there is something new.' : 'bookshelv ist verbunden. Du bekommst hier einen kurzen Hinweis, wenn es etwas Neues gibt.' })
    }).catch(() => {});
  }
  setSetting('telegram_offset', String(j.result.at(-1)!.update_id + 1));
}
