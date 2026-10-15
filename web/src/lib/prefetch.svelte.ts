/**
 * Offline-Abgleich (App mit Konto): den ganzen eigenen Stand vorab laden, damit unterwegs jede Seite da ist –
 * nicht nur die, die man zuletzt geöffnet hatte. Es werden genau die Adressen abgerufen, die die Seiten selbst
 * nutzen; der API-Client legt jede Antwort in den Lesecache (offline.svelte.ts), Cover speichert der App-Host.
 *
 * Leicht (Start, Regal, Listen, Statistik …): beim Start und nach der Rückkehr in die App, höchstens alle 10 Minuten.
 * Voll (jede Buchseite + Cover): höchstens alle 3 Tage oder auf Knopfdruck – schont kleine Instanzen (Shared Hosting).
 * Schonend: 3 Anfragen gleichzeitig.
 */
import { api, type ShelfItem, type ReadingListSummary } from './api.ts';
import { session } from './state.svelte.ts';
import { net } from './offline.svelte.ts';
import { app } from './app.svelte.ts';

const KEY = 'bookshelv-offline-sync';
type Saved = { light: number; full: number };
function saved(): Saved {
  try { return { light: 0, full: 0, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { light: 0, full: 0 }; }
}
function save(s: Saved) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* voll */ } }

export const offlineSync = $state({ running: false, done: 0, total: 0, last: saved().full ? new Date(saved().full).toISOString() : '' });

const LIGHT_EVERY = 10 * 60_000, FULL_EVERY = 3 * 24 * 3600_000;

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<unknown>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && net.online) {
      const x = items[i++];
      await fn(x).catch(() => {});
      offlineSync.done++;
    }
  }));
}

/** Nur in der App mit Konto (lokal liegt ohnehin alles auf dem Gerät) */
export const canSync = () => app.info?.mode === 'remote' && !!session.me && !session.me.local;

export async function syncNow(forceFull = false) {
  if (!canSync() || offlineSync.running || !net.online) return;
  const s = saved();
  const now = Date.now();
  const full = forceFull || now - s.full > FULL_EVERY;
  if (!full && now - s.light < LIGHT_EVERY) return;
  offlineSync.running = true;
  offlineSync.done = 0;
  try {
    const me = session.me!.id;
    const light = ['/home', '/loans', '/feed?limit=6', '/copies', '/wishlist', '/lists', '/stats', '/authors', '/me/top',
      `/users/${me}/profile`, `/users/${me}/lists`, `/feed?user=${me}&limit=5`];
    offlineSync.total = light.length;
    const got: Record<string, unknown> = {};
    await pool(light, 3, async url => { got[url] = await api.get(url); });
    s.light = now;
    if (full && net.online) {
      const copies = (got['/copies'] as ShelfItem[] | undefined) ?? [];
      const wishes = (got['/wishlist'] as { book: { id: number; coverUrl: string | null } }[] | undefined) ?? [];
      const lists = (got['/lists'] as ReadingListSummary[] | undefined) ?? [];
      const books = new Map<number, string | null>();
      for (const c of copies) books.set(c.book.id, c.book.coverUrl);
      for (const w of wishes) books.set(w.book.id, w.book.coverUrl);
      const urls: string[] = lists.map(l => `/lists/${l.id}`);
      for (const id of books.keys()) urls.push(`/books/${id}`, `/books/${id}/reviews`, `/history?book=${id}`, `/feed?book=${id}&limit=20`);
      const covers = [...books.values()].filter((u): u is string => !!u && u.startsWith('/covers/'));
      offlineSync.total += urls.length + covers.length;
      await pool(urls, 3, url => api.get(url));
      // Cover einmal anfragen – der App-Host legt sie dauerhaft ab
      await pool(covers, 4, url => fetch(url).then(r => r.blob()));
      if (net.online) { s.full = Date.now(); offlineSync.last = new Date(s.full).toISOString(); }
    }
    save(s);
  } finally {
    offlineSync.running = false;
  }
}
