/** Darstellung: dunkel (Standard), hell oder wie das Gerät. Gespeichert nur im Browser. */
export type Theme = 'dark' | 'light' | 'system';
const KEY = 'bookshelv-theme';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'system') return t;
  } catch { /* privater Modus */ }
  return 'dark';
}

export function applyTheme(t: Theme = getTheme()) {
  if (t === 'dark') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#121516' : '#ffffff'));
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* egal */ }
  applyTheme(t);
}
