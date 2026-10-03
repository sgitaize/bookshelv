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
export type PendingScan = { isbn: string; target: ScanTarget; at: string; format?: 'print' | 'ebook'; binding?: 'paperback' | 'hardcover' | null };

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
