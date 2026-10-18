/**
 * Web Push je Gerät ein- und ausschalten. Der Server schickt leere Pushes, der Service Worker zeigt
 * „n neue Benachrichtigungen“ (siehe public/sw.js). In den Apps (WebView) gibt es kein Web Push.
 */
import { api } from './api.ts';
import { inApp } from './app.svelte.ts';

export const pushSupported = () =>
  !inApp() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  return navigator.serviceWorker.getRegistration('/').then(r => r ?? navigator.serviceWorker.ready);
}

export async function pushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try { return await (await registration()).pushManager.getSubscription(); } catch { return null; }
}

const keyBytes = (b64url: string) => {
  const raw = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

/** true = eingeschaltet; false = Erlaubnis verweigert */
export async function enablePush(): Promise<boolean> {
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const { key } = await api.get<{ key: string }>('/push/key');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api.post('/push/subscribe', { endpoint: sub.endpoint });
  return true;
}

export async function disablePush() {
  const sub = await pushSubscription();
  if (!sub) return;
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
