/**
 * Anbindung an öffentliche Kataloge. Für den Browser laufen alle Anfragen über den Server, damit er nie direkt mit
 * Dritten spricht (DSGVO). In den Apps läuft derselbe Code auf dem Gerät (Lokal-Modus und Titelsuche im Instanz-Modus,
 * siehe mobile/host.ts) – so steht es auch in der Datenschutzerklärung (web/src/routes/Legal.svelte). Cover werden lokal gespeichert.
 *
 *  - Deutsche Nationalbibliothek (SRU, oai_dc): beste Quelle für deutschsprachige Titel
 *  - Open Library: international, Cover, Seitenzahlen
 *  - K10plus (GBV/SWB): Ausweichkatalog, wenn die DNB drosselt
 *  - DNB/MVB-Cover als Fallback, wenn Open Library kein Cover hat
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.ts';
import { lettersOnly } from './util.ts';

export type BookData = {
  isbn13: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  year: number | null;
  pages: number | null;
  language: string | null;
  subjects: string[];
  source: string;
  /** Reihe + Band, nur wenn sicher erkannt (keine Verlagsreihen wie „dtv ; 21412“) */
  series?: { name: string; index: number | null } | null;
};

export type SearchHit = BookData & { coverHint: { isbn?: string; ol?: number } | null };

const coverDir = path.join(config.dataDir, 'covers');

// Zeitpunkt der letzten gestörten DNB-Antwort (429/5xx/Zeitüberschreitung) – sonst sieht „nicht gefunden“ aus wie „gibt es nicht“
let dnbTroubleAt = 0;
export const dnbUnavailable = () => Date.now() - dnbTroubleAt < 5 * 60_000;
function dnbTrouble(url: string, why: string) {
  if (!url.startsWith('https://services.dnb.de/')) return;
  if (!dnbUnavailable()) console.warn(`DNB gestört: ${why}`);
  dnbTroubleAt = Date.now();
}

// Nur für Tests: alle Katalogabrufe über einen Proxy, der aufgezeichnete Antworten abspielt (tests/catalog-fixtures.mjs),
// damit die Testsuite nicht an einer gedrosselten DNB scheitert
const catalogProxy = process.env.BOOKSHELV_CATALOG_PROXY;

async function get(url: string, timeoutMs = 8000): Promise<Response | null> {
  try {
    const res = await fetch(catalogProxy ? `${catalogProxy}/?url=${encodeURIComponent(url)}` : url, { headers: { 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 429 || res.status >= 500) dnbTrouble(url, `HTTP ${res.status}`);
    return res.ok ? res : null;
  } catch (e) {
    dnbTrouble(url, String((e as Error)?.name ?? e));
    return null;
  }
}

// ---------- ISBN ----------

export function normalizeIsbn(raw: string): string | null {
  const s = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 13 && /^\d{13}$/.test(s)) {
    const sum = [...s.slice(0, 12)].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null;
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((a, d, i) => a + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
    if (sum % 11 !== 0) return null;
    const base = '978' + s.slice(0, 9);
    const check = (10 - ([...base].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
    return base + check;
  }
  return null;
}

// ---------- DNB ----------

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function dcAll(record: string, tag: string): string[] {
  const re = new RegExp(`<dc:${tag}[^>]*>([^<]*)</dc:${tag}>`, 'g');
  return [...record.matchAll(re)].map(m => decodeXml(m[1]).trim());
}

/** "[Originaltitel] ; Titel : Untertitel / Verantwortlich" → { title, subtitle } */
function parseDnbTitle(raw: string): { title: string; subtitle: string | null } {
  let t = raw.replace(/¬/g, '').split(' / ')[0];
  t = t.replace(/^(\[[^\]]*\]\s*;\s*)+/, '');
  const [title, ...rest] = t.split(' : ');
  return { title: title.trim(), subtitle: rest.join(' : ').trim() || null };
}

/** "Herbert, Frank [Verfasser]" → "Frank Herbert"; nur Verfasser, keine Übersetzer/Sprecher */
function parseDnbAuthors(creators: string[]): string[] {
  const authors = creators
    .filter(c => !/\[(?!Verfasser)[^\]]+\]/.test(c))
    .map(c => c.replace(/\s*\[[^\]]*\]/g, '').trim())
    .map(c => (c.includes(', ') ? c.split(', ').reverse().join(' ') : c));
  return [...new Set(authors)];
}

function parseDnbRecord(rec: string): BookData | null {
  const titleRaw = dcAll(rec, 'title')[0];
  if (!titleRaw) return null;
  const isbns = dcAll(rec, 'identifier').map(id => normalizeIsbn(id.split(' ')[0])).filter(Boolean) as string[];
  const { title, subtitle } = parseDnbTitle(titleRaw);
  const publisher = dcAll(rec, 'publisher')[0]?.split(' : ').pop()?.trim() || null;
  const year = Number(dcAll(rec, 'date')[0]?.match(/\d{4}/)?.[0]) || null;
  const pages = Number(dcAll(rec, 'format').join(' ').match(/(\d+)\s*Seiten/)?.[1]) || null;
  return {
    isbn13: isbns[0] ?? null,
    title, subtitle,
    authors: parseDnbAuthors(dcAll(rec, 'creator')),
    publisher, year, pages,
    language: dcAll(rec, 'language')[0] ?? null,
    subjects: dcAll(rec, 'subject').map(x => x.replace(/^[\dB]+\s+/, '').trim()).filter(Boolean),
    source: 'dnb'
  };
}

export async function dnbQuery(query: string, max: number): Promise<BookData[]> {
  const url = `https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&recordSchema=oai_dc`
    + `&maximumRecords=${max}&query=${encodeURIComponent(query)}`;
  const res = await get(url);
  if (!res) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<record>([\s\S]*?)<\/record>/g)]
    .map(m => parseDnbRecord(m[1]))
    .filter((b): b is BookData => b !== null);
}

/**
 * Genres aus dem MARC21-Datensatz der DNB: oai_dc liefert nur die grobe Sachgruppe ("B Belletristik"),
 * das eigentliche Genre steht in Feld 655 (GND-Gattung) und in der Buchhandels-Warengruppe (653 "(VLB-WN)…").
 */
export async function dnbGenres(isbn: string): Promise<string[]> {
  return (await dnbMarc(isbn))?.genres ?? [];
}

/** Genres und Reihe aus dem MARC21-Datensatz der DNB (null = Dienst nicht erreichbar) */
export async function dnbMarc(isbn: string): Promise<{ genres: string[]; series: { name: string; index: number | null } | null } | null> {
  const res = await get(`https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&recordSchema=MARC21-xml`
    + `&maximumRecords=1&query=${encodeURIComponent('num=' + isbn)}`);
  if (!res) return null;
  const { blocks, sub, fields } = marcAccess(await res.text());
  return { genres: marcGenres(fields), series: marcSeries(blocks, sub) };
}

/** Zugriff auf Datenfelder eines MARC21-XML-Datensatzes */
function marcAccess(xml: string) {
  const blocks = (tag: string) => [...xml.matchAll(new RegExp(`<datafield tag="${tag}"[^>]*>([\\s\\S]*?)</datafield>`, 'g'))].map(m => m[1]);
  const sub = (block: string, code: string) => [...block.matchAll(new RegExp(`<subfield code="${code}">([^<]*)</subfield>`, 'g'))].map(x => cleanMarc(x[1]));
  const fields = (tag: string) => blocks(tag).map(b => sub(b, 'a'));
  return { blocks, sub, fields };
}

// ---------- K10plus (Verbundkatalog GBV/SWB) ----------
// Ausweichkatalog, wenn die DNB drosselt (429) oder nicht antwortet: frei, ohne Schlüssel, enthält auch die DNB-Datensätze
// und liefert MARC21 – also dieselben Genres und Reihen wie die DNB.

const K10 = 'https://sru.k10plus.de/{db}?version=1.1&operation=searchRetrieve&recordSchema=marcxml';

/** "Owens, Delia" → "Delia Owens" */
const flipName = (n: string) => n.replace(/[,.\s]+$/, '').split(', ').reverse().join(' ');

/** Gedrucktes Buch aus einem MARC21-Datensatz; Filme, Musik, E-Books und Datensätze ohne ISBN → null */
function parseMarcBook(rec: string): (BookData & { isbn13: string }) | null {
  const leader = rec.match(/<leader>([^<]*)<\/leader>/)?.[1] ?? '';
  if (leader[6] !== 'a' || leader[7] !== 'm') return null; // nur Text, Monografie
  const { blocks, sub, fields } = marcAccess(rec);
  const one = (tag: string, code: string) => blocks(tag).map(b => sub(b, code)[0]).find(Boolean) ?? null;
  const physical = [...fields('300').flat(), ...fields('338').flat()].join(' ');
  if (/online|ressource|resource/i.test(physical)) return null;
  const isbn13 = blocks('020').flatMap(b => sub(b, 'a')).map(normalizeIsbn).find(Boolean);
  const title = one('245', 'a')?.replace(/\s*[/:;=.]\s*$/, '').trim();
  if (!isbn13 || !title) return null;
  const f008 = rec.match(/<controlfield tag="008">([^<]*)</)?.[1] ?? '';
  const authors = [
    ...blocks('100').map(b => sub(b, 'a')[0]),
    // weitere Personen nur als Verfasser*in, keine Übersetzer*innen/Herausgeber*innen
    ...blocks('700').filter(b => sub(b, '4').includes('aut') || sub(b, 'e').some(e => /verfasser/i.test(e))).map(b => sub(b, 'a')[0])
  ].filter(Boolean).map(flipName);
  return {
    isbn13, title,
    subtitle: one('245', 'b')?.replace(/\s*[/:;=.]\s*$/, '').trim() || null,
    authors: [...new Set(authors)],
    publisher: (one('264', 'b') ?? one('260', 'b'))?.replace(/\s*[,;:]\s*$/, '') || null,
    year: Number((one('264', 'c') ?? one('260', 'c') ?? '').match(/\d{4}/)?.[0] ?? f008.slice(7, 11)) || null,
    pages: Number(physical.match(/(\d+)\s*(Seiten|S\.|pages|p\.)/)?.[1]) || null,
    language: one('041', 'a') ?? (f008.slice(35, 38).trim() || null),
    subjects: [...marcGenres(fields), ...fields('650').map(a => a[0]).filter(Boolean)].slice(0, 15),
    source: 'k10plus',
    series: marcSeries(blocks, sub)
  };
}

async function k10Query(query: string, max: number, timeoutMs = 8000): Promise<(BookData & { isbn13: string })[]> {
  // GVK ist vollständiger, braucht aber zufällig mal 0,5 s, mal 20 s; SWB ist schnell, kennt aber weniger →
  // beide parallel fragen, GVK nach 2,5 und 5 s nochmal (meist ist die Wiederholung schnell), die erste Antwort mit Treffern gewinnt
  let done = false;
  const ask = async (db: string, delay = 0) => {
    if (delay) await new Promise(r => setTimeout(r, delay));
    if (done) throw new Error('schon fertig');
    const res = await get(`${K10.replace('{db}', db)}&maximumRecords=${max}&query=${encodeURIComponent(query)}`, timeoutMs);
    const books = res ? [...(await res.text()).matchAll(/<record xmlns[^>]*>([\s\S]*?)<\/record>/g)].map(m => parseMarcBook(m[0])).filter(b => b !== null) : [];
    if (!books.length) throw new Error('leer');
    done = true;
    return books;
  };
  return Promise.any([ask('gvk'), ask('swb'), ask('gvk', 2500), ask('gvk', 5000)]).catch(() => []);
}

/** MARC-Text: Nichtsortier-Zeichen (&#152;Der&#156;) entfernen */
const cleanMarc = (s: string) => decodeXml(s.replace(/&#15[26];/g, '')).replace(/[\u0098\u009c]/g, '').trim();

/**
 * Reihe aus 490/830 ($a Reihe, $v Band) oder 800 ($t Reihe, $v Band). Verlagsreihen fallen raus:
 * dort ist der Band eine Bestellnummer (dtv 21412, Carlsen 401) und der Name meist der Verlag.
 */
function marcSeries(blocks: (tag: string) => string[], sub: (block: string, code: string) => string[]) {
  const publishers = [...blocks('264'), ...blocks('260')].flatMap(b => sub(b, 'b')).map(p => p.toLowerCase());
  const candidates = [
    ...blocks('800').map(b => ({ name: sub(b, 't')[0], v: sub(b, 'v')[0] })),
    ...blocks('830').map(b => ({ name: sub(b, 'a')[0], v: sub(b, 'v')[0] })),
    ...blocks('490').map(b => ({ name: sub(b, 'a')[0], v: sub(b, 'v')[0] }))
  ];
  for (const c of candidates) {
    if (!c.name) continue;
    const name = c.name.replace(/\s*[;:,.]\s*$/, '').trim();
    const num = c.v?.match(/(\d+(?:[.,]\d+)?)/)?.[1];
    const index = num ? Number(num.replace(',', '.')) : null;
    if (index != null && index > 60) continue;
    const low = name.toLowerCase();
    if (publishers.some(p => p && (p.includes(low) || low.includes(p)))) continue;
    if (/(taschenbuch|tb\b|bibliothek|edition|klassik|reihe|verlag|bücher|books|paperback)/i.test(name) && index == null) continue;
    return { name, index };
  }
  return null;
}

function marcGenres(fields: (tag: string) => string[][]): string[] {
  const genres: string[] = [];
  for (const [a] of fields('655')) if (a) genres.push(a);
  for (const subs of fields('653')) for (const a of subs) {
    // "(VLB-WN)2121: Taschenbuch / Belletristik/Krimis, Thriller, Spionage" → "Krimis, Thriller, Spionage"
    const m = a.match(/^\(VLB-WN\)\d+:\s*(.*)$/);
    if (m) genres.push(...m[1].split('/').map(x => x.trim()).filter(x => x && !/^(Taschenbuch|Hardcover|Softcover)$/i.test(x)));
  }
  // zu allgemein, steht bei fast jedem Roman
  return [...new Set(genres)].filter(g => g !== 'Fiktionale Darstellung');
}

// ---------- Open Library ----------

type OlEdition = {
  title?: string; subtitle?: string; authors?: { name: string }[]; publishers?: { name: string }[];
  publish_date?: string; number_of_pages?: number; cover?: { large?: string }; subjects?: { name: string }[];
};

async function olByIsbn(isbn: string): Promise<BookData | null> {
  const res = await get(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!res) return null;
  const data = (await res.json())[`ISBN:${isbn}`] as OlEdition | undefined;
  if (!data?.title) return null;
  return {
    isbn13: isbn,
    title: data.title,
    subtitle: data.subtitle ?? null,
    authors: data.authors?.map(a => a.name) ?? [],
    publisher: data.publishers?.[0]?.name ?? null,
    year: Number(data.publish_date?.match(/\d{4}/)?.[0]) || null,
    pages: data.number_of_pages ?? null,
    language: null,
    // Open Library hat viele Rausch-Schlagworte (nyt:…, "Fiction, general") – nur kurze, saubere übernehmen
    subjects: (data.subjects ?? []).map(x => x.name).filter(n => !n.includes(':') && n.length <= 40).slice(0, 12),
    source: 'openlibrary'
  };
}

/**
 * Reihe aus dem Open-Library-Editionsdatensatz: „Harry Potter, Band 1“, „Harry Potter #1“, „Discworld (3)“.
 * Ergänzt die DNB, die z. B. bei Carlsen nur die Verlagsreihe kennt.
 */
export async function olSeries(isbn: string): Promise<{ name: string; index: number | null } | null> {
  const res = await get(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!res?.ok) return null;
  const raw = ((await res.json().catch(() => ({}))) as { series?: string[] }).series?.[0];
  return raw ? parseSeriesLabel(raw) : null;
}

export function parseSeriesLabel(raw: string): { name: string; index: number | null } | null {
  const m = raw.trim().match(/^(.*?)[\s,;:(]*(?:#|band|bd\.?|vol\.?|volume|book|teil|nr\.?|no\.?)?\s*(\d+(?:[.,]\d+)?)\)?\s*$/i);
  const name = (m ? m[1] : raw).replace(/[\s,;:(]+$/, '').trim();
  const index = m ? Number(m[2].replace(',', '.')) : null;
  if (!name || name.length > 120 || (index != null && index > 60)) return null;
  return { name, index };
}

type OlSearchEdition = { title?: string; subtitle?: string; isbn?: string[]; cover_i?: number; publisher?: string[]; publish_date?: string[]; language?: string[] };
type OlDoc = { title: string; author_name?: string[]; isbn?: string[]; cover_i?: number; first_publish_year?: number; editions?: { docs?: OlSearchEdition[] } };

/**
 * Open-Library-Suche. Mit lang=de liefert OL je Werk die passendste deutsche Ausgabe mit (Titel, ISBN, Cover) –
 * sonst stünde „Where the Crawdads Sing“ mit deutscher ISBN in der Liste statt „Der Gesang der Flusskrebse“.
 */
async function olSearch(q: string, max: number): Promise<SearchHit[]> {
  // `key` muss in fields stehen, sonst liefert OL keine editions
  const res = await get(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${max}&lang=de`
    + `&fields=key,title,author_name,isbn,cover_i,first_publish_year,editions,editions.title,editions.subtitle,editions.isbn,editions.cover_i,editions.publisher,editions.publish_date,editions.language`);
  if (!res) return [];
  const docs = ((await res.json()).docs ?? []) as OlDoc[];
  return docs.map(d => {
    const e = d.editions?.docs?.[0];
    const isbn13 = (list?: string[]) => (list ?? []).filter(i => i.length === 13);
    const eIsbn = isbn13(e?.isbn)[0];
    const isbns = isbn13(d.isbn);
    // deutsche Ausgabe bevorzugen, falls vorhanden
    const isbn = eIsbn ?? isbns.find(i => i.startsWith('9783')) ?? isbns[0] ?? null;
    const cover = (eIsbn && e?.cover_i) || d.cover_i;
    return {
      isbn13: isbn, title: (eIsbn && e?.title) || d.title, subtitle: (eIsbn && e?.subtitle) || null, authors: d.author_name ?? [],
      publisher: (eIsbn && e?.publisher?.[0]) || null,
      year: (eIsbn && Number(e?.publish_date?.[0]?.match(/\d{4}/)?.[0])) || d.first_publish_year || null,
      pages: null, language: eIsbn && e?.language?.[0] === 'ger' ? 'de' : null, subjects: [], source: 'openlibrary',
      coverHint: cover ? { ol: cover } : isbn ? { isbn } : null
    };
  });
}

/** Begleitmaterial und Merchandise, das bei Titelsuchen sonst die eigentlichen Bücher verdrängt */
const JUNK = /\b(tarot|colou?ring book|malbuch|box ?set|collection set|books? collection|pen loop|notizbuch|kalender|calendar|lektürehilfe|interpretationshilfe|interpretation|kopiervorlagen?|unterrichtsmaterial|lösungen|arbeitsheft|study guide|summary of|workbook|sparknotes|königs erläuterungen|planner|dayplanner|set of \d+ books|literaturunterricht|didaktische|analyse|untersuchung)\b/i;

// ---------- öffentliche Funktionen ----------

/** Erstes Ergebnis, das nicht leer ist (oder null, wenn keins etwas liefert) – wartet nicht auf die langsameren */
function firstHit<T>(ps: Promise<T | null>[]): Promise<T | null> {
  return new Promise(resolve => {
    let left = ps.length;
    for (const p of ps) p.then(v => { if (v) resolve(v); }, () => {}).finally(() => { if (!--left) resolve(null); });
  });
}

/**
 * Metadaten zu einer ISBN. Die ISBN ist eindeutig, also reicht zum Anlegen die erste Quelle mit Treffer (`first`,
 * meist die DNB nach ~0,5 s); `full` führt alle Quellen zusammen (Genres, Reihe, Seiten) und wird nachgetragen.
 */
export function lookupIsbnFast(isbn13: string): { first: Promise<BookData | null>; full: Promise<BookData | null> } {
  // K10plus gleich mitstarten (nicht erst nach der DNB warten), genutzt wird es nur, wenn die DNB ausfällt
  const k10p = k10Query(`pica.isb=${isbn13}`, 5).then(r => r[0] ?? null);
  const dnbP = dnbQuery(`num=${isbn13}`, 1).then(r => r[0] ?? null);
  const olP = olByIsbn(isbn13);
  const marcP = dnbMarc(isbn13);
  const olsP = olSeries(isbn13).catch(() => null);
  const full = (async () => {
    const [dnbHit, ol, dnbM, ols] = await Promise.all([dnbP, olP, marcP, olsP]);
    // DNB gedrosselt oder ohne Treffer → K10plus springt ein (gleiche Datenqualität, auch Genres und Reihe)
    const k10 = !dnbHit || !dnbM ? await k10p : null;
    const dnb = dnbHit ?? k10;
    const marc = dnbM ?? (k10 ? { genres: [], series: k10.series ?? null } : null);
    const genres = marc?.genres ?? [];
    if (!dnb && !ol) return null;
    // DNB-Titel sind für deutsche Bücher meist korrekter, Open Library ergänzt Lücken
    const a = dnb ?? ol!, b = ol ?? dnb!;
    return {
      isbn13,
      title: a.title || b.title,
      subtitle: a.subtitle ?? b.subtitle,
      authors: a.authors.length ? a.authors : b.authors,
      publisher: a.publisher ?? b.publisher,
      year: a.year ?? b.year,
      pages: b.pages ?? a.pages,
      language: a.language ?? b.language,
      // Genres zuerst, dann Sachgruppen; die DDC-Sprachgruppe ("830 Deutsche Literatur" → "Deutsche Literatur") bleibt dahinter
      subjects: [...new Set([...genres, ...a.subjects, ...b.subjects])].slice(0, 15),
      source: [dnb?.source, ol && 'openlibrary'].filter(Boolean).join('+'),
      series: marc?.series ?? ols ?? null
    };
  })().catch(() => null);
  const first = firstHit<BookData>([dnbP, olP, k10p]).then(d => d && { ...d, isbn13 });
  return { first, full };
}

/** Metadaten zu einer ISBN aus allen Quellen zusammenführen. */
export const lookupIsbn = (isbn13: string) => lookupIsbnFast(isbn13).full;

type Tracked<T> = { p: Promise<T>; v?: T };
const track = <T>(p: Promise<T>): Tracked<T> => { const t: Tracked<T> = { p }; p.then(v => { t.v = v; }, () => {}); return t; };
type Sources = { dnb: Tracked<BookData[]>; ol: Tracked<SearchHit[]>; k10: Tracked<BookData[]> };

/**
 * Laufende/fertige Katalogabfragen je Suchbegriff (10 min): die schnelle und die vollständige Stufe derselben Suche
 * (und erneutes Tippen) teilen sich eine Abfrage pro Quelle
 */
const searches = new Map<string, { at: number; s: Sources }>();
function catalogSources(q: string, words: string[]): Sources {
  const key = words.join(' ').toLowerCase();
  const cached = searches.get(key);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.s;
  const dnbQ = words.map(w => `woe=${w.replace(/["=()<>]/g, '')}`).join(' and ') + ' and mat=books'; // ohne Hörbücher/Medien
  const k10Q = words.map(w => `pica.all=${w.replace(/["=()<>]/g, '')}`).join(' and ');
  const s: Sources = {
    // Die DNB ist oft langsam oder drosselt (429) – nicht länger als 4 s auf sie warten
    dnb: track(Promise.race([dnbQuery(dnbQ, 20), new Promise<BookData[]>(r => setTimeout(() => r([]), 4000))])),
    ol: track(olSearch(q, 20)),
    // K10plus läuft mit, zählt aber nur, wenn die DNB nichts liefert (drosselt, zu langsam oder ohne Treffer)
    k10: track(k10Query(k10Q, 20, 5000))
  };
  searches.delete(key);
  searches.set(key, { at: Date.now(), s });
  if (searches.size > 200) searches.delete(searches.keys().next().value!);
  // Alles leer (Netz weg, Quellen gestört)? Nicht merken, beim nächsten Mal neu fragen
  Promise.all([s.dnb.p, s.ol.p, s.k10.p]).then(r => { if (r.every(x => !x.length) && searches.get(key)?.s === s) searches.delete(key); }, () => searches.delete(key));
  return s;
}

/**
 * Titelsuche über DNB, Open Library und K10plus.
 * `fast`: antwortet, sobald die erste Quelle Treffer hat (meist die DNB nach ~0,5 s), mit allem, was bis dahin da ist;
 * die Oberfläche fragt parallel ohne `fast` nach und ersetzt die Liste, sobald auch Open Library (oft 2–8 s) da ist.
 */
export async function searchCatalog(q: string, opts: { fast?: boolean } = {}): Promise<SearchHit[]> {
  const words = q.trim().split(/\s+/).filter(w => w.length > 1).slice(0, 6);
  if (!words.length) return [];
  const s = catalogSources(q, words);
  const some = <T>(t: Tracked<T[]>) => t.p.then(r => (r.length ? r : null));
  if (opts.fast) await firstHit<unknown>([some(s.dnb), some(s.ol), some(s.k10)]);
  else await Promise.all([s.dnb.p, s.ol.p, s.k10.p]);
  // DNB-Treffer, sonst K10plus; im schnellen Modus nur, was schon da ist
  const dnb = s.dnb.v?.length ? s.dnb.v : s.k10.v ?? [];
  const ol = s.ol.v ?? [];
  const terms = words.map(w => w.toLowerCase());
  const asked = (re: RegExp) => terms.some(t => re.test(t)); // wer „Tarot“ sucht, bekommt Tarot
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  // DNB zuerst: bei deutschen Büchern die besseren Metadaten; dieselbe ISBN von OL wird dann übersprungen
  for (const h of [...dnb.map(b => ({ ...b, coverHint: b.isbn13 ? { isbn: b.isbn13 } : null })), ...ol]) {
    if (!h.isbn13) continue; // ohne ISBN nicht eindeutig importierbar – dafür gibt es die manuelle Erfassung
    if (seen.has(h.isbn13)) continue;
    if (JUNK.test(`${h.title} ${h.subtitle ?? ''}`) && !asked(JUNK)) continue;
    seen.add(h.isbn13);
    hits.push(h);
  }
  // Relevanz: wie viele Suchwörter in Titel/Autor vorkommen, Titel, der genau der Suche entspricht, ganz nach oben;
  // Treffer ohne Autor und Cover nach hinten, deutsche Ausgaben leicht bevorzugt
  const query = terms.join(' ');
  const score = (h: SearchHit) => {
    const hay = `${h.title} ${h.subtitle ?? ''} ${h.authors.join(' ')}`.toLowerCase();
    const title = lettersOnly(h.title.toLowerCase());
    return terms.filter(t => hay.includes(t)).length * 10 + terms.filter(t => title.includes(t)).length * 3
      + (title === query || title.replace(/^(der|die|das|the) /, '') === query.replace(/^(der|die|das|the) /, '') ? 8 : 0)
      + (h.authors.length ? 3 : -5) + (h.coverHint?.ol || h.source !== 'openlibrary' ? 1 : 0)
      + (h.isbn13!.startsWith('9783') || h.language === 'ger' || h.language === 'de' ? 2 : 0);
  };
  return hits
    .map((h, i) => ({ h, s: score(h), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 25)
    .map(x => x.h);
}

// ---------- Cover ----------

async function downloadImage(url: string): Promise<{ buf: Buffer; ext: string } | null> {
  const res = await get(url, 10000);
  if (!res) return null;
  const type = res.headers.get('content-type') ?? '';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : null;
  if (!ext) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  // winzige Bilder sind Platzhalter ("kein Cover")
  if (buf.length < 2000 || buf.length > 5 * 1024 * 1024) return null;
  return { buf, ext };
}

async function findCoverImage(hint: { isbn?: string; ol?: number }) {
  const tries: string[] = [];
  if (hint.ol) tries.push(`https://covers.openlibrary.org/b/id/${hint.ol}-L.jpg`);
  if (hint.isbn) {
    tries.push(`https://covers.openlibrary.org/b/isbn/${hint.isbn}-L.jpg?default=false`);
    tries.push(`https://portal.dnb.de/opac/mvb/cover?isbn=${hint.isbn}`);
  }
  for (const url of tries) {
    const img = await downloadImage(url);
    if (img) return img;
  }
  return null;
}

/** Cover herunterladen und lokal ablegen; gibt den Dateinamen zurück. */
export async function fetchCover(hint: { isbn?: string; ol?: number }): Promise<string | null> {
  let preview = await previewCover(hint); // meist schon von der Suche im Cache
  // Für viele Ausgaben hat Open Library kein Bild unter der ISBN, wohl aber am Werk (dasselbe Cover zeigt die Suche)
  if (!preview && hint.isbn && !hint.ol) {
    const ol = await olCoverId(hint.isbn);
    if (ol) preview = await previewCover({ ol });
  }
  if (!preview) return null;
  const name = `${hint.isbn ?? 'ol' + hint.ol}-${crypto.randomBytes(4).toString('hex')}.${preview.ext}`;
  // kein copyFileSync: libuv ruft dabei fchown auf, das der systemd-Seccomp-Filter (@privileged) mit SIGSYS bestraft
  fs.writeFileSync(path.join(coverDir, name), fs.readFileSync(preview.file));
  return name;
}

/** Cover-ID des Werks zu einer ISBN (Open-Library-Suche liefert cover_i auch für Ausgaben ohne eigenes Bild) */
async function olCoverId(isbn: string): Promise<number | null> {
  const res = await get(`https://openlibrary.org/search.json?isbn=${isbn}&fields=cover_i&limit=1`);
  if (!res) return null;
  try { return ((await res.json()).docs?.[0]?.cover_i as number | undefined) ?? null; } catch { return null; }
}

/** Vorschaubilder für Suchergebnisse: einmal laden, dann aus dem Cache (alte Einträge räumt prunePreviews weg). */
const previewDir = path.join(coverDir, 'preview');
fs.mkdirSync(previewDir, { recursive: true });

export function prunePreviews(maxAgeDays = 30) {
  const limit = Date.now() - maxAgeDays * 86400_000;
  for (const f of fs.readdirSync(previewDir)) {
    const p = path.join(previewDir, f);
    if (fs.statSync(p).mtimeMs < limit) fs.rmSync(p, { force: true });
  }
}

export async function previewCover(hint: { isbn?: string; ol?: number }): Promise<{ file: string; ext: string } | null> {
  const key = hint.ol ? `ol${hint.ol}` : `isbn${hint.isbn}`;
  for (const ext of ['jpg', 'png', 'webp']) {
    const file = path.join(previewDir, `${key}.${ext}`);
    if (fs.existsSync(file)) return { file, ext };
  }
  if (fs.existsSync(path.join(previewDir, `${key}.none`))) return null;
  const img = await findCoverImage(hint);
  if (!img) {
    fs.writeFileSync(path.join(previewDir, `${key}.none`), '');
    return null;
  }
  const file = path.join(previewDir, `${key}.${img.ext}`);
  fs.writeFileSync(file, img.buf);
  return { file, ext: img.ext };
}

export function deleteCoverFile(name: string | null) {
  if (!name || name.includes('/') || name.includes('..')) return;
  fs.rmSync(path.join(coverDir, name), { force: true });
}

export const coverPath = (name: string) => path.join(coverDir, path.basename(name));
