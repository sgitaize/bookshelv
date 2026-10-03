import { api, ApiError, type Me } from './api.ts';

/** Angemeldeter Nutzer; undefined = wird noch geladen, null = nicht angemeldet */
export const session = $state<{ me: Me | null | undefined; needsSetup: boolean }>({ me: undefined, needsSetup: false });

export async function loadSession() {
  try {
    session.me = await api.get<Me>('/me');
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    session.me = null;
    session.needsSetup = (await api.get<{ needsSetup: boolean }>('/status')).needsSetup;
  }
}

// ---------- Toasts ----------

type Toast = { id: number; text: string; kind: 'ok' | 'error' };
export const toasts = $state<Toast[]>([]);
let nextId = 1;

export function toast(text: string, kind: Toast['kind'] = 'ok') {
  const id = nextId++;
  toasts.push({ id, text, kind });
  setTimeout(() => {
    const i = toasts.findIndex(t => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, kind === 'error' ? 5000 : 2800);
}

export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error');
