/**
 * Brücke zur iOS-/Android-App. Im Browser ist `app.info` null und alles hier tut nichts.
 *
 * Die App setzt vor dem Laden `window.bookshelvApp` (Plattform, Modus, Instanz) und nimmt Nachrichten über
 * `window.webkit.messageHandlers.bookshelv` (iOS) bzw. `window.bookshelvAndroid.post` entgegen.
 * Antworten und Ereignisse der App kommen über `window.bookshelvNative.dispatch({ type, … })`.
 */
import { clearApiCache } from './offline.svelte.ts';

export type AppInfo = {
  platform: 'ios' | 'android';
  /** local = Bibliothek nur auf dem Gerät, remote = Konto auf einer Instanz */
  mode: 'local' | 'remote';
  /** öffentliche Adresse der Instanz (für Einladungslinks, @name@host) */
  instance: string | null;
  version: string;
  /** nativer ISBN-Scanner vorhanden (iOS: VisionKit) */
  scanner: boolean;
};

type Native = { postMessage(m: unknown): void };
const w = window as unknown as {
  bookshelvApp?: AppInfo;
  webkit?: { messageHandlers?: { bookshelv?: Native } };
  bookshelvAndroid?: { post(json: string): void };
  bookshelvNative?: { dispatch(ev: AppEvent): void };
};

export const app = $state<{ info: AppInfo | null }>({ info: w.bookshelvApp ?? null });
export const inApp = () => !!app.info;

export function post(action: string, payload: Record<string, unknown> = {}) {
  const msg = { a: action, ...payload };
  if (w.webkit?.messageHandlers?.bookshelv) w.webkit.messageHandlers.bookshelv.postMessage(msg);
  else w.bookshelvAndroid?.post(JSON.stringify(msg));
}

/** Öffentliche Adresse dieser Instanz: in der App läuft die Seite auf 127.0.0.1, Links sollen aber zur Instanz zeigen */
export const publicOrigin = () => app.info?.instance ?? location.origin;
export const publicHost = () => new URL(publicOrigin()).host;

// ---------- Ereignisse aus der App ----------

export type AppEvent =
  | { type: 'scan'; id: number; isbn: string }
  | { type: 'scanClosed'; id: number }
  | { type: 'file'; name: string; text: string }
  | { type: 'navigate'; path: string }
  | { type: 'refresh' };

type Listener = (ev: AppEvent) => void;
const listeners = new Set<Listener>();
export function onAppEvent(fn: Listener) { listeners.add(fn); return () => listeners.delete(fn); }
w.bookshelvNative = { dispatch: ev => { for (const fn of [...listeners]) fn(ev); } };

/** Datei, die mit „Öffnen in bookshelv“ an die App ging (Export aus Booky, Goodreads …) – die Import-Seite holt sie ab */
export const incoming = $state<{ file: { name: string; text: string } | null }>({ file: null });

// ---------- Kleine Helfer ----------

export function haptic(kind: 'light' | 'medium' | 'success' | 'warning' | 'error' | 'select' = 'light') {
  if (inApp()) post('haptic', { k: kind });
}

/** App-Einstellungen (Sicherung, Konto verbinden, Instanz wechseln, Unterstützen) als native Ansicht öffnen */
export function openAppPanel(section: 'overview' | 'backup' | 'connect' | 'switch' | 'support' = 'overview') {
  post('panel', { s: section });
}

/** nativer Scanner gerade offen → Hinweise (Toasts) erscheinen auch dort */
export const scanner = $state({ open: false });

let scanSeq = 0;
/**
 * Nativer Scanner. `onIsbn` wird für jede erkannte ISBN aufgerufen (im Mehrfach-Modus mehrmals);
 * das Promise erfüllt sich, sobald der Scanner geschlossen ist.
 */
export function nativeScan(opts: { multi: boolean; onIsbn: (isbn: string) => void }): Promise<void> {
  const id = ++scanSeq;
  scanner.open = true;
  return new Promise(resolve => {
    const off = onAppEvent(ev => {
      if (ev.type === 'scan' && ev.id === id) opts.onIsbn(ev.isbn);
      if (ev.type === 'scanClosed' && ev.id === id) { off(); scanner.open = false; resolve(); }
    });
    post('scan', { id, multi: opts.multi });
  });
}

/** Ergebnis eines Scans an den offenen Scanner zurückmelden (grün = übernommen, gelb = schon da, rot = unbekannt) */
export function scanFeedback(text: string, kind: 'ok' | 'warn' | 'error') {
  post('scanFeedback', { text, kind });
}

// ---------- Getrennte Daten je Instanz ----------
// Lokal und Konto laufen auf verschiedenen Ports (eigene Origins). Wechselt man innerhalb des Konto-Modus
// die Instanz, gehören vorgemerkte Scans/Änderungen und der Lesecache nicht mehr dazu.
const INSTANCE_KEY = 'bookshelv-app-instance';
if (app.info?.mode === 'remote') {
  try {
    const before = localStorage.getItem(INSTANCE_KEY);
    if (before !== null && before !== app.info.instance) {
      for (const k of Object.keys(localStorage)) if (k.startsWith('bookshelv-') && k !== 'bookshelv-lang' && k !== 'bookshelv-theme' && k !== 'bookshelv-font') localStorage.removeItem(k);
      clearApiCache();
    }
    localStorage.setItem(INSTANCE_KEY, app.info.instance ?? '');
  } catch { /* privat/voll */ }
}
