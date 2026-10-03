/**
 * Mini-i18n: Wörterbücher in ./locales, Sprache reaktiv (Svelte-Runes), gespeichert nur im Browser.
 * t('key', { n: 3 }) ersetzt {n}; tn('key', n) wählt key.one / key.other.
 */
import de from './locales/de.ts';
import en from './locales/en.ts';

export type Lang = 'de' | 'en';
export type Key = keyof typeof de;

const dicts: Record<Lang, Record<Key, string>> = { de, en };
const KEY = 'bookshelv-lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch { /* privater Modus */ }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

class I18n {
  lang = $state<Lang>(initial());

  set(l: Lang) {
    this.lang = l;
    try { localStorage.setItem(KEY, l); } catch { /* egal */ }
    document.documentElement.lang = l;
  }

  get locale() {
    return this.lang === 'de' ? 'de-DE' : 'en-GB';
  }
}

export const i18n = new I18n();
document.documentElement.lang = i18n.lang;

export function t(key: Key, params?: Record<string, string | number>): string {
  let s = dicts[i18n.lang][key] ?? dicts.de[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Einzahl/Mehrzahl: erwartet Schlüssel "<key>.one" und "<key>.other" */
export function tn(key: string, n: number, params?: Record<string, string | number>): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}` as Key, { n, ...params });
}

export const fmtDate = (d: string | Date | null) => {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d.length === 10 ? d : d.replace(' ', 'T') + (d.includes('Z') || d.includes('T') ? '' : 'Z')) : d;
  return date.toLocaleDateString(i18n.locale);
};
