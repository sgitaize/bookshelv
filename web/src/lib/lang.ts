// Sprachen zum schnellen Auswählen (Simon: Deutsch, Englisch, Spanisch), weitere über „Andere …“
import { i18n, t } from './i18n.svelte.ts';

export const QUICK_LANGS = ['de', 'en', 'es'] as const;
export const MORE_LANGS = ['fr', 'it', 'nl', 'pt', 'sv', 'da', 'no', 'pl', 'tr', 'ru', 'ja', 'la'] as const;

let names: Intl.DisplayNames | null = null;
let namesFor = '';
/** „de“ → „Deutsch“ (in der UI-Sprache), „unknown“ → „Unbekannt“ */
export function langName(code: string | null | undefined): string {
  if (!code || code === 'unknown') return t('lang.unknown');
  try {
    if (namesFor !== i18n.locale) { names = new Intl.DisplayNames([i18n.locale], { type: 'language' }); namesFor = i18n.locale; }
    return names?.of(code) ?? code;
  } catch { return code; }
}
