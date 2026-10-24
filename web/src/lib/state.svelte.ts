import { setPrefs } from './theme.ts';
import { scanner, scanFeedback } from './app.svelte.ts';
import { api, ApiError, type Me } from './api.ts';
import { net, isNetworkError, rememberMe, cachedMe, forgetMe, loadPending, loadWrites, warmOfflineCache, QueuedError } from './offline.svelte.ts';

/** App im Lokal-Modus: Bibliothek nur auf dem Gerät – alles, was andere Menschen braucht, bleibt ausgeblendet */
export const isLocal = () => !!session.me?.local;

/** Angemeldeter Nutzer; undefined = wird noch geladen, null = nicht angemeldet */
export const session = $state<{ me: Me | null | undefined; needsSetup: boolean }>({ me: undefined, needsSetup: false });

export async function loadSession() {
  try {
    session.me = await api.get<Me>('/me');
    // am Konto gespeicherte Darstellung gilt auf jedem Gerät
    if (session.me.prefs?.theme || session.me.prefs?.font) setPrefs(session.me.prefs);
    rememberMe(session.me);
    loadPending(session.me.id);
    loadWrites(session.me.id);
    setTimeout(warmOfflineCache, 3000);
    if (session.me.prefs?.avoidNotes) loadAvoid();
  } catch (e) {
    // ohne Netz mit dem zuletzt bekannten Konto weitermachen (Scannen geht offline)
    const me = isNetworkError(e) ? cachedMe<Me>() : null;
    if (me) { session.me = me; net.online = false; loadPending(me.id); loadWrites(me.id); return; }
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    forgetMe();
    session.me = null;
    session.needsSetup = (await api.get<{ needsSetup: boolean }>('/status')).needsSetup;
  }
}

// ---------- Inhaltshinweise, die ich meiden will ----------

/** Bücher/Cover mit gemiedenen Inhaltshinweisen (Cover werden verdeckt); revealed = auf der Buchseite bewusst aufgedeckt */
export const avoid = $state<{ tags: string[]; books: number[]; covers: string[]; revealed: string[] }>({ tags: [], books: [], covers: [], revealed: [] });
export async function loadAvoid() {
  if (!session.me) return;
  try { Object.assign(avoid, await api.get<{ tags: string[]; books: number[]; covers: string[] }>('/me/content-avoid')); } catch { /* offline: bleibt wie es war */ }
}

// ---------- Melden (ein Dialog für die ganze App, siehe ReportSheet in App.svelte) ----------

export type ReportTarget = { type: 'review' | 'comment' | 'user' | 'post'; id: number; userId: number; name: string };
export const reporting = $state<{ target: ReportTarget | null }>({ target: null });
export const report = (target: ReportTarget) => (reporting.target = target);

// ---------- Instanz (Impressum-Link der betreibenden Person) ----------

export const instance = $state({ imprintUrl: '', openRegistration: false, full: false, loaded: false });
export async function loadInstance() {
  try {
    const s = await api.get<{ imprintUrl: string | null; openRegistration?: boolean; full?: boolean }>('/status');
    instance.imprintUrl = s.imprintUrl ?? '';
    instance.openRegistration = !!s.openRegistration;
    instance.full = !!s.full;
  } catch { /* offline */ } finally { instance.loaded = true; }
}

// ---------- Benachrichtigungen (Zähler für die Glocke) ----------

export const notifications = $state({ unread: 0 });
let lastPoll = 0;

/** Höchstens alle 30 s nachfragen; wird bei Navigation und periodisch aufgerufen */
export async function pollNotifications(force = false) {
  if (!session.me || (!force && Date.now() - lastPoll < 30_000)) return;
  lastPoll = Date.now();
  try { notifications.unread = (await api.get<{ unread: number }>('/notifications/count')).unread; } catch { /* offline */ }
}

// ---------- Toasts ----------

type Toast = { id: number; text: string; kind: 'ok' | 'error'; key?: string };
export const toasts = $state<Toast[]>([]);
let nextId = 1;

/** key: gleichartige Hinweise ersetzen sich (z. B. viele Bücher nacheinander zur Liste) statt sich zu stapeln */
export function toast(text: string, kind: Toast['kind'] = 'ok', key?: string) {
  // Massen-Scan in der App: Rückmeldung direkt im nativen Scanner zeigen (die Seite ist dann verdeckt)
  if (scanner.open) scanFeedback(text, kind === 'error' ? 'error' : 'ok');
  const id = nextId++;
  if (key) { const old = toasts.findIndex(t => t.key === key); if (old >= 0) toasts.splice(old, 1); }
  toasts.push({ id, text, kind, key });
  setTimeout(() => {
    const i = toasts.findIndex(t => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, kind === 'error' ? 5000 : 2800);
}

// offline vorgemerkt ist kein Fehler → normaler Hinweis
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), e instanceof QueuedError ? 'ok' : 'error');
