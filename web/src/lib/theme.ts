/**
 * Darstellung: Farbthema und Schrift. Wird am Konto gespeichert (folgt auf alle Geräte) und zusätzlich
 * im Browser zwischengespeichert, damit beim Start nichts aufblitzt.
 */
export const THEMES = ['night', 'light', 'paper', 'ink', 'forest', 'rose', 'system'] as const;
export type Theme = (typeof THEMES)[number];
export const FONTS = ['typewriter', 'modern'] as const;
export type Font = (typeof FONTS)[number];
export type Prefs = { theme?: Theme; font?: Font };

/** Vorschaufarben für die Auswahl (Hintergrund, Fläche, Akzent) und Farbe der Browserleiste */
export const SWATCH: Record<Exclude<Theme, 'system'>, [string, string, string]> = {
  night: ['#121516', '#242a2b', '#5fb0b3'],
  light: ['#ffffff', '#f1f3f3', '#33777c'],
  paper: ['#f3ebd7', '#ece2c8', '#9c2f24'],
  ink: ['#10141f', '#212a3d', '#d9b25f'],
  forest: ['#111713', '#223027', '#93c283'],
  rose: ['#fbf3f3', '#f6e8e9', '#a3405f']
};

const KEY = 'bookshelv-theme', FKEY = 'bookshelv-font';
let current: Prefs = {};

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    let v = localStorage.getItem(key);
    if (v === 'dark') v = 'night'; // alter Wert vor den Themes
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch { /* privater Modus */ }
  return fallback;
}

export const getTheme = () => read(KEY, THEMES, 'night');
export const getFont = () => read(FKEY, FONTS, 'typewriter');

const dark = matchMedia('(prefers-color-scheme: dark)');
dark.addEventListener('change', () => { if (getTheme() === 'system') applyTheme(); });

export function applyTheme(p: Prefs = {}) {
  const theme = p.theme ?? getTheme();
  const font = p.font ?? getFont();
  current = { theme, font };
  const resolved = theme === 'system' ? (dark.matches ? 'night' : 'light') : theme;
  const el = document.documentElement;
  if (resolved === 'night') delete el.dataset.theme; else el.dataset.theme = resolved;
  if (font === 'typewriter') delete el.dataset.font; else el.dataset.font = font;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', SWATCH[resolved][0]));
}

/** Lokal übernehmen und merken; das Speichern am Konto macht der Aufrufer (PATCH /me) */
export function setPrefs(p: Prefs) {
  const next = { ...current, ...p };
  try {
    if (next.theme) localStorage.setItem(KEY, next.theme);
    if (next.font) localStorage.setItem(FKEY, next.font);
  } catch { /* egal */ }
  applyTheme(next);
}
