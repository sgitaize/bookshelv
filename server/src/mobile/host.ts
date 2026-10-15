/**
 * App-Host: läuft in der iOS-App (nodejs-mobile) und später unter Android.
 *
 * Drei Ports, alle nur auf 127.0.0.1:
 *  - Steuerung (BS_CONTROL_PORT): nur für die native App (Header x-bs-token) – Modus, Sicherung, Zusammenführen.
 *  - Lokal (BS_LOCAL_PORT): der ganz normale bookshelv-Server im Lokal-Modus (eine Person, Daten auf dem Gerät).
 *    Wird erst gestartet, wenn er gebraucht wird – wer nur ein Konto nutzt, hat keine lokale Datenbank.
 *  - Instanz (BS_REMOTE_PORT): liefert dieselbe mitgelieferte Oberfläche aus und leitet /api, /covers, /avatars
 *    an die gewählte Instanz weiter. Das Sitzungs-Cookie der Instanz bleibt hier im Host (Datei im App-Ordner),
 *    die WebView bekommt es nie zu sehen. Cover/Avatare werden zusätzlich für unterwegs zwischengespeichert.
 *
 * Getrennte Ports = getrennte Origins in der WebView: localStorage/Offline-Cache von Lokal und Konto mischen sich nicht.
 */
import './shims.ts';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { nodeFetch } from './shims.ts';

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`${k} fehlt`);
  return v;
};
const TOKEN = env('BS_TOKEN');
const CONTROL_PORT = Number(env('BS_CONTROL_PORT'));
const LOCAL_PORT = Number(env('BS_LOCAL_PORT'));
const REMOTE_PORT = Number(env('BS_REMOTE_PORT'));
const DATA = env('BS_DATA');            // lokale Bibliothek (bookshelv.db, covers/, avatars/)
const VAR = env('BS_VAR');              // Host-Zustand (Sitzung der Instanz, Cache)
const PUBLIC = env('BS_PUBLIC');        // mitgelieferte Oberfläche
const VERSION = env('BS_VERSION', 'app');

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(VAR, 'cache'), { recursive: true });

const log = (...a: unknown[]) => console.log('[host]', ...a);

// ---------- Zustand der Instanz-Verbindung ----------

type Remote = { url: string | null; cookie: string | null; expires: string | null };
const remoteFile = path.join(VAR, 'remote.json');
let remote: Remote = { url: null, cookie: null, expires: null };
try { remote = { ...remote, ...JSON.parse(fs.readFileSync(remoteFile, 'utf8')) }; } catch { /* erster Start */ }
function saveRemote() {
  const tmp = remoteFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(remote), { mode: 0o600 });
  fs.renameSync(tmp, remoteFile);
}
const loggedIn = () => !!remote.cookie && (!remote.expires || new Date(remote.expires) > new Date());

/** Instanz-Adresse vereinheitlichen: „bookshelv.aize-it.de“ → https://bookshelv.aize-it.de */
function normalizeUrl(raw: string): string {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.endsWith('.local'))))
    throw new Error('Nur https-Adressen');
  return `${u.protocol}//${u.host}`;
}

/** Anfrage an die Instanz mit der gespeicherten Sitzung (für Steuerbefehle, nicht für die WebView) */
async function remoteApi<T>(method: string, p: string, body?: unknown): Promise<{ status: number; data: T }> {
  if (!remote.url) throw new Error('Keine Instanz gewählt');
  const res = await nodeFetch(remote.url + p, {
    method,
    headers: {
      origin: remote.url, 'content-type': 'application/json', 'x-lang': lang,
      ...(remote.cookie ? { cookie: `bs_session=${remote.cookie}` } : {})
    },
    body: body === undefined ? (method === 'GET' ? null : '{}') : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  captureCookie(res.headers.get('set-cookie'));
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() as T : (null as T);
  return { status: res.status, data };
}
let lang = 'de';

/** Set-Cookie der Instanz auswerten (nur bs_session interessiert) */
function captureCookie(header: string | string[] | null | undefined) {
  if (!header) return;
  for (const raw of Array.isArray(header) ? header : splitCookies(header)) {
    const m = raw.match(/^\s*bs_session=([^;]*)/);
    if (!m) continue;
    const value = decodeURIComponent(m[1]);
    const exp = raw.match(/;\s*expires=([^;]+)/i)?.[1];
    const maxAge = raw.match(/;\s*max-age=(-?\d+)/i)?.[1];
    const expires = maxAge !== undefined ? new Date(Date.now() + Number(maxAge) * 1000) : exp ? new Date(exp) : null;
    if (!value || (expires && expires <= new Date())) { remote.cookie = null; remote.expires = null; }
    else { remote.cookie = value; remote.expires = expires?.toISOString() ?? null; }
    saveRemote();
  }
}
/** fetch() fasst mehrere Set-Cookie mit Komma zusammen – an Kommas vor „name=“ trennen (Expires enthält auch Kommas) */
const splitCookies = (h: string) => h.split(/,(?=\s*[A-Za-z0-9_-]+=)/);

// ---------- Lokaler Server (erst bei Bedarf) ----------

let local: Promise<void> | null = null;
function startLocal(name?: string): Promise<void> {
  if (local) return local;
  process.env.BOOKSHELV_LOCAL = '1';
  process.env.BOOKSHELV_APP_TOKEN = TOKEN;
  process.env.BOOKSHELV_DATA_DIR = DATA;
  process.env.BOOKSHELV_PUBLIC_DIR = PUBLIC;
  process.env.BOOKSHELV_APP_DIR = DATA;
  process.env.PORT = String(LOCAL_PORT);
  process.env.HOST = '127.0.0.1';
  if (name) process.env.BOOKSHELV_LOCAL_NAME = name;
  local = (async () => {
    require('../main.ts');
    for (let i = 0; i < 100; i++) {
      try { if ((await nodeFetch(`http://127.0.0.1:${LOCAL_PORT}/api/status`)).ok) return; } catch { /* startet noch */ }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Lokaler Server startet nicht');
  })();
  return local;
}
const localDb = () => (require('../db.ts') as typeof import('../db.ts'));
const hasLocalLibrary = () => fs.existsSync(path.join(DATA, 'bookshelv.db'));

/** Anfrage an den lokalen Server als die eine lokale Person */
async function localApi<T>(method: string, p: string, body?: unknown): Promise<T> {
  await startLocal();
  const res = await nodeFetch(`http://127.0.0.1:${LOCAL_PORT}/api${p}`, {
    method,
    headers: { 'x-bookshelv-app': TOKEN, 'content-type': 'application/json', origin: `http://127.0.0.1:${LOCAL_PORT}` },
    body: body === undefined ? (method === 'GET' ? null : '{}') : JSON.stringify(body)
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error(data?.error ?? `Fehler ${res.status}`);
  return data;
}

function localSummary() {
  if (!local) return null;
  const { db } = localDb();
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    books: n('SELECT COUNT(DISTINCT book_id) AS n FROM copies WHERE removed_at IS NULL'),
    read: n("SELECT COUNT(*) AS n FROM user_books WHERE status = 'read'"),
    reviews: n('SELECT COUNT(*) AS n FROM reviews'),
    wishlist: n('SELECT COUNT(*) AS n FROM wishlist'),
    lists: n('SELECT COUNT(*) AS n FROM lists'),
    loans: n('SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL'),
    name: (db.prepare('SELECT display_name AS n FROM users ORDER BY id LIMIT 1').get() as { n: string } | undefined)?.n ?? null
  };
}

// ---------- Sicherung (iCloud) ----------

/** Konsistente Kopie der lokalen Datenbank (VACUUM INTO) nach <dir>/bookshelv.db */
function snapshotTo(dir: string) {
  const { db } = localDb();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `bookshelv.${process.pid}.tmp`);
  fs.rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp);
  fs.renameSync(tmp, path.join(dir, 'bookshelv.db'));
  return { file: path.join(dir, 'bookshelv.db'), size: fs.statSync(path.join(dir, 'bookshelv.db')).size, summary: localSummary() };
}

/** Prüft eine Sicherung, bevor sie die eigene Bibliothek ersetzt */
function checkBackup(file: string) {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const probe = new DatabaseSync(file);
  try {
    const ok = (probe.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    if (ok !== 'ok') throw new Error('Die Sicherung ist beschädigt');
    if (!probe.prepare("SELECT 1 FROM sqlite_master WHERE name = 'books'").get()) throw new Error('Das ist keine bookshelv-Sicherung');
  } finally { probe.close(); }
}

/** Ordner mit bookshelv.db (+ covers/, avatars/) als lokale Bibliothek übernehmen */
async function restoreFrom(dir: string) {
  const src = path.join(dir, 'bookshelv.db');
  if (!fs.existsSync(src)) throw new Error('Sicherung nicht gefunden');
  checkBackup(src);
  const copyDirs = () => {
    for (const sub of ['covers', 'avatars']) {
      const from = path.join(dir, sub);
      if (!fs.existsSync(from)) continue;
      fs.mkdirSync(path.join(DATA, sub), { recursive: true });
      for (const f of fs.readdirSync(from)) {
        const to = path.join(DATA, sub, f);
        if (!fs.existsSync(to) && fs.statSync(path.join(from, f)).isFile()) fs.copyFileSync(path.join(from, f), to);
      }
    }
  };
  const replace = () => {
    for (const ext of ['-wal', '-shm']) fs.rmSync(path.join(DATA, 'bookshelv.db' + ext), { force: true });
    fs.copyFileSync(src, path.join(DATA, 'bookshelv.db.restore'));
    fs.renameSync(path.join(DATA, 'bookshelv.db.restore'), path.join(DATA, 'bookshelv.db'));
  };
  if (local) {
    await local;
    localDb().swapDatabase(replace);
  } else replace();
  copyDirs();
  await startLocal();
  return localSummary();
}

/** Nach dem Zusammenführen: lokale Bibliothek ins Archiv (es gibt danach nur noch die Datenbank der Instanz) */
async function archiveLocal() {
  const dest = path.join(VAR, 'archive', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dest, { recursive: true });
  if (local) {
    await local;
    snapshotTo(dest);
    // Datei leeren: der lokale Server läuft weiter, sieht aber ab jetzt eine leere Bibliothek
    localDb().swapDatabase(() => {
      for (const ext of ['', '-wal', '-shm']) fs.rmSync(path.join(DATA, 'bookshelv.db' + ext), { force: true });
    });
  } else if (hasLocalLibrary()) {
    fs.copyFileSync(path.join(DATA, 'bookshelv.db'), path.join(dest, 'bookshelv.db'));
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(path.join(DATA, 'bookshelv.db' + ext), { force: true });
  }
  for (const sub of ['covers', 'avatars']) {
    const from = path.join(DATA, sub);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dest, sub), { recursive: true });
  }
  return { archive: dest };
}

// ---------- Steuerung ----------

type Handler = (body: Record<string, unknown>) => Promise<unknown> | unknown;
const routes: Record<string, Handler> = {
  'GET /state': () => ({
    version: VERSION,
    local: { running: !!local, exists: hasLocalLibrary(), summary: localSummary() },
    remote: { url: remote.url, loggedIn: loggedIn() }
  }),
  'POST /lang': b => { if (typeof b.lang === 'string') lang = b.lang.slice(0, 5); return { ok: true }; },

  // Lokal
  'POST /local/start': async b => { await startLocal(typeof b.name === 'string' ? b.name.slice(0, 60) : undefined); return { summary: localSummary() }; },
  'POST /local/snapshot': async b => { await startLocal(); return snapshotTo(String(b.dir ?? path.join(DATA, 'snapshot'))); },
  'POST /local/check': b => { checkBackup(path.join(String(b.dir), 'bookshelv.db')); return { ok: true }; },
  'POST /local/restore': async b => ({ summary: await restoreFrom(String(b.dir)) }),
  'POST /local/archive': () => archiveLocal(),

  // Instanz
  'POST /remote/probe': async b => {
    const url = normalizeUrl(String(b.url ?? ''));
    const res = await nodeFetch(`${url}/api/status`, { signal: AbortSignal.timeout(15_000), headers: { 'x-lang': lang } });
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok || !data || !('needsSetup' in data)) throw new Error('Unter dieser Adresse läuft kein bookshelv');
    return { url, status: data };
  },
  'POST /remote/use': b => {
    const url = normalizeUrl(String(b.url ?? ''));
    if (url !== remote.url) remote = { url, cookie: null, expires: null };
    saveRemote();
    return { url, loggedIn: loggedIn() };
  },
  'GET /remote/me': async () => {
    if (!remote.url || !remote.cookie) return { me: null };
    const r = await remoteApi<Record<string, unknown>>('GET', '/api/me');
    return { me: r.status === 200 ? r.data : null };
  },
  'POST /remote/logout': async () => {
    if (remote.cookie) await remoteApi('POST', '/api/logout').catch(() => null);
    remote.cookie = null; remote.expires = null;
    saveRemote();
    return { ok: true };
  },

  // Zusammenführen: lokale Bibliothek als Import-Job in das angemeldete Konto
  'POST /merge/start': async b => {
    if (!loggedIn()) throw new Error('Nicht bei der Instanz angemeldet');
    const data = await localApi<{ items: unknown[]; follows: string[] }>('GET', '/me/export.json');
    if (!data.items.length && !data.follows.length) return { id: null, empty: true };
    const conflict = ['ask', 'mine', 'theirs'].includes(String(b.conflict)) ? b.conflict : 'ask';
    const visibility = ['private', 'instance', 'federated'].includes(String(b.visibility)) ? b.visibility : 'instance';
    const r = await remoteApi<{ id?: number; error?: string }>('POST', '/api/imports/jobs', {
      source: 'bookshelv-app', filename: String(b.label ?? 'App'), items: data.items, follows: data.follows,
      options: { copies: 'none', conflict, visibility, lists: true, reviews: true, wishlist: true }
    });
    if (r.status !== 200 || !r.data?.id) throw new Error(r.data?.error ?? `Fehler ${r.status}`);
    return { id: r.data.id, total: data.items.length };
  },
  'POST /merge/status': async b => {
    const r = await remoteApi<Record<string, unknown>>('GET', `/api/imports/${Number(b.id)}`);
    if (r.status !== 200) throw new Error((r.data as { error?: string })?.error ?? `Fehler ${r.status}`);
    return r.data;
  }
};

function json(res: http.ServerResponse, status: number, data: unknown) {
  const s = JSON.stringify(data ?? null);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}
async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

http.createServer(async (req, res) => {
  if (!safeEqual(String(req.headers['x-bs-token'] ?? ''), TOKEN)) return json(res, 403, { error: 'forbidden' });
  const route = routes[`${req.method} ${(req.url ?? '').split('?')[0]}`];
  if (!route) return json(res, 404, { error: 'unknown' });
  try {
    const raw = await readBody(req);
    const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    json(res, 200, await route(body));
  } catch (e) {
    log(req.url, e);
    json(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}).listen(CONTROL_PORT, '127.0.0.1', () => log(`Steuerung auf ${CONTROL_PORT}`));

// ---------- Instanz-Port: Oberfläche aus dem Bundle, API zur Instanz ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.txt': 'text/plain'
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const rel = path.normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(PUBLIC, 'index.html');
  const immutable = rel.startsWith('/assets/');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer', 'host', 'cookie', 'origin', 'referer']);
/** Cover/Avatare ändern sich nie (Zufallsanteil im Dateinamen) → auf dem Gerät behalten, dann gehen sie auch offline */
const cacheable = (p: string) => /^\/(covers|avatars)\/[A-Za-z0-9._-]+$/.test(p);
const cacheFile = (p: string) => path.join(VAR, 'cache', p.replace(/^\//, '').replace('/', '_'));

function proxy(req: http.IncomingMessage, res: http.ServerResponse) {
  const p = (req.url ?? '/').split('?')[0];
  if (!remote.url) { req.socket.destroy(); return; }
  if (req.method === 'GET' && cacheable(p) && fs.existsSync(cacheFile(p))) {
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
    fs.createReadStream(cacheFile(p)).pipe(res);
    return;
  }
  const target = new URL(req.url ?? '/', remote.url);
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP.has(k)) headers[k] = v;
  headers.host = target.host;
  if (req.headers.origin) headers.origin = remote.url;            // CSRF-Prüfung der Instanz
  if (loggedIn()) headers.cookie = `bs_session=${remote.cookie}`;
  const mod = target.protocol === 'https:' ? https : http;
  const out = mod.request(target, { method: req.method, headers, timeout: 30_000 }, up => {
    captureCookie(up.headers['set-cookie']);
    const h: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(up.headers)) if (v !== undefined && k !== 'set-cookie' && !HOP.has(k)) h[k] = v;
    res.writeHead(up.statusCode ?? 502, h);
    if (req.method === 'GET' && up.statusCode === 200 && cacheable(p) && !up.headers['content-encoding']) {
      const tmp = cacheFile(p) + '.part';
      const file = fs.createWriteStream(tmp);
      up.on('data', c => file.write(c));
      up.on('end', () => file.end(() => fs.rename(tmp, cacheFile(p), () => {})));
      up.on('error', () => { file.destroy(); fs.rm(tmp, { force: true }, () => {}); });
    }
    up.pipe(res);
  });
  // Instanz nicht erreichbar → Verbindung kappen: die Oberfläche erkennt so „offline“ (TypeError in fetch) und nimmt ihren Cache
  const fail = () => { if (!res.headersSent) req.socket.destroy(); else res.destroy(); };
  out.on('timeout', () => out.destroy());
  out.on('error', fail);
  req.pipe(out);
}

http.createServer((req, res) => {
  const p = (req.url ?? '/').split('?')[0];
  if (p.startsWith('/api/') || cacheable(p)) return proxy(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });
  serveStatic(req, res);
}).listen(REMOTE_PORT, '127.0.0.1', () => log(`Instanz-Port ${REMOTE_PORT} → ${remote.url ?? '(keine)'}`));

// Lokale Bibliothek vorhanden → gleich starten (dann ist sie da, wenn die WebView lädt)
if (process.env.BS_START_LOCAL === '1') startLocal().catch(e => log('Lokal-Start', e));

process.on('uncaughtException', e => log('uncaught', e));
process.on('unhandledRejection', e => log('unhandled', e));
