/**
 * Offline-Grundlagen: Netzstatus und Warteschlange für Scans ohne Internet (Bauchladen, Flohmarkt).
 * Die Scans liegen nur auf diesem Gerät (localStorage, je Konto) und werden später nachgeschlagen.
 */
export const net = $state({ online: navigator.onLine });
addEventListener('online', () => (net.online = true));
addEventListener('offline', () => (net.online = false));

/** Netzfehler (kein Server erreichbar) im Unterschied zu einer Fehlerantwort des Servers */
export const isNetworkError = (e: unknown) => e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError');

export type ScanTarget = 'wishlist' | 'shelf';
export type PendingScan = { isbn: string; target: ScanTarget; at: string; format?: 'print' | 'ebook' | 'audio'; binding?: 'paperback' | 'hardcover' | null };

const key = (userId: number) => `bookshelv-scans-${userId}`;
export const pending = $state<{ userId: number | null; items: PendingScan[] }>({ userId: null, items: [] });

function save() {
  if (!pending.userId) return;
  try { localStorage.setItem(key(pending.userId), JSON.stringify(pending.items)); } catch { /* voll/privat */ }
}

export function loadPending(userId: number) {
  pending.userId = userId;
  try { pending.items = JSON.parse(localStorage.getItem(key(userId)) ?? '[]'); } catch { pending.items = []; }
}

/** Scan merken; gleiche ISBN mit gleichem Ziel nur einmal. Gibt false zurück, wenn schon vorhanden. */
export function queueScan(isbn: string, target: ScanTarget, copy?: Pick<PendingScan, 'format' | 'binding'>): boolean {
  if (pending.items.some(p => p.isbn === isbn && p.target === target)) return false;
  pending.items = [...pending.items, { isbn, target, at: new Date().toISOString(), ...copy }];
  save();
  return true;
}

export function dropScan(isbn: string, target: ScanTarget) {
  pending.items = pending.items.filter(p => !(p.isbn === isbn && p.target === target));
  save();
}

// ---------- Angemeldet bleiben ohne Netz ----------

const ME = 'bookshelv-me';
export function rememberMe(me: unknown) {
  try { localStorage.setItem(ME, JSON.stringify(me)); } catch { /* egal */ }
}
export function cachedMe<T>(): T | null {
  try { return JSON.parse(localStorage.getItem(ME) ?? 'null'); } catch { return null; }
}
export function forgetMe() {
  try { localStorage.removeItem(ME); } catch { /* egal */ }
  clearApiCache();
}

/**
 * Damit der Scanner offline startet: zxing (Fallback für iOS/Firefox) einmal laden, solange Netz da ist –
 * der Service Worker legt die Dateien unter /assets/ dauerhaft in den Cache.
 */
export async function warmOfflineCache() {
  if (!net.online || !('serviceWorker' in navigator)) return;
  try {
    const [, { default: wasmUrl }] = await Promise.all([import('zxing-wasm/reader'), import('zxing-wasm/reader/zxing_reader.wasm?url')]);
    await fetch(wasmUrl);
  } catch { /* nächster Versuch beim nächsten Start */ }
}

// ---------- Änderungen ohne Netz (Lesestand, Bewertungen) ----------

/**
 * Nur idempotente PUTs kommen in die Warteschlange: gleiche Adresse = letzter Stand gewinnt
 * (beim Lesestand werden die Felder zusammengeführt). Liegt je Konto im localStorage, Abgleich beim Wieder-online-Sein.
 */
export type QueuedWrite = { url: string; body: Record<string, unknown>; at: string };
export const QUEUEABLE = /^\/books\/\d+\/(reading|review)$/;
export const writes = $state<{ items: QueuedWrite[] }>({ items: [] });
const wkey = (id: number) => `bookshelv-writes-${id}`;

/** Wird vom API-Client geworfen, wenn eine Änderung offline vorgemerkt wurde (kein Fehler im eigentlichen Sinn) */
export class QueuedError extends Error { queued = true; }

function saveWrites() {
  if (!pending.userId) return;
  try { localStorage.setItem(wkey(pending.userId), JSON.stringify(writes.items)); } catch { /* voll/privat */ }
}
export function loadWrites(userId: number) {
  try { writes.items = JSON.parse(localStorage.getItem(wkey(userId)) ?? '[]'); } catch { writes.items = []; }
}
export function queueWrite(url: string, body: Record<string, unknown>) {
  const prev = writes.items.find(w => w.url === url);
  const merged = prev && url.endsWith('/reading') ? { ...prev.body, ...body } : body;
  writes.items = [...writes.items.filter(w => w.url !== url), { url, body: merged, at: new Date().toISOString() }];
  saveWrites();
}

/**
 * Vorgemerkte Änderungen nacheinander senden. Netzfehler → abbrechen und später erneut;
 * Ablehnung durch den Server (4xx, z. B. Buch inzwischen gelöscht) → verwerfen und mitzählen.
 */
export async function flushWrites(send: (url: string, body: unknown) => Promise<unknown>) {
  let ok = 0, failed = 0;
  for (const w of [...writes.items]) {
    try { await send(w.url, w.body); ok++; }
    catch (e) {
      if (isNetworkError(e)) break;
      failed++;
    }
    // nur genau diesen Eintrag entfernen – eine neuere Änderung an derselben Adresse bleibt stehen
    writes.items = writes.items.filter(x => x.url !== w.url || x.at !== w.at);
    saveWrites();
  }
  return { ok, failed };
}

// ---------- Lesecache: zuletzt geladene Daten offline anzeigen ----------

const API_CACHE = 'bookshelv-api-v1';
export async function cacheGet(url: string, data: unknown) {
  try { await (await caches.open(API_CACHE)).put(url, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })); } catch { /* kein Cache-API */ }
}
export async function cachedGet<T>(url: string): Promise<T | undefined> {
  try { const r = await (await caches.open(API_CACHE)).match(url); return r ? (await r.json()) as T : undefined; } catch { return undefined; }
}
export function clearApiCache() {
  try { caches.delete(API_CACHE); } catch { /* egal */ }
}
