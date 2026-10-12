/**
 * Sprache eines Buchs – gemeinsam für Statistik, Regal und Buchseite.
 */

/** DNB liefert ISO 639-2/B („ger“), Open Library oft nichts – dann Sprachraum aus der ISBN-Gruppe schätzen */
const LANG: Record<string, string> = {
  ger: 'de', deu: 'de', de: 'de', eng: 'en', en: 'en', fre: 'fr', fra: 'fr', fr: 'fr', spa: 'es', es: 'es', ita: 'it', it: 'it',
  dut: 'nl', nld: 'nl', nl: 'nl', swe: 'sv', sv: 'sv', dan: 'da', da: 'da', nor: 'no', no: 'no', pol: 'pl', pl: 'pl',
  por: 'pt', pt: 'pt', tur: 'tr', tr: 'tr', rus: 'ru', ru: 'ru', jpn: 'ja', ja: 'ja', lat: 'la', la: 'la'
};
/** Sprache als ISO-639-1-Code (de, en, …), „unknown“ wenn nichts bekannt */
export function langOf(language: string | null, isbn13: string | null): string {
  const code = language?.trim().toLowerCase();
  if (code && LANG[code]) return LANG[code];
  if (code) return code;
  const g = isbn13?.startsWith('978') ? isbn13.slice(3) : null;
  if (!g) return 'unknown';
  if (g[0] === '3') return 'de';
  if (g[0] === '0' || g[0] === '1') return 'en';
  if (g[0] === '2') return 'fr';
  if (g.startsWith('88')) return 'it';
  if (g.startsWith('84')) return 'es';
  if (g.startsWith('90') || g.startsWith('94')) return 'nl';
  return 'unknown';
}

/** erlaubte manuelle Sprache: zweistelliger Code oder null (= wieder automatisch) */
export const LANG_CODE = /^[a-z]{2}$/;
