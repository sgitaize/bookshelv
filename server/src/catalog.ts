/**
 * Anbindung an öffentliche Kataloge. Alle Anfragen laufen über den Server, damit die Browser der Nutzer
 * nie direkt mit Dritten sprechen (DSGVO). Cover werden lokal gespeichert.
 *
 *  - Deutsche Nationalbibliothek (SRU, oai_dc): beste Quelle für deutschsprachige Titel
 *  - Open Library: international, Cover, Seitenzahlen
 *  - DNB/MVB-Cover als Fallback, wenn Open Library kein Cover hat
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.ts';

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
};

export type SearchHit = BookData & { coverHint: { isbn?: string; ol?: number } | null };

const coverDir = path.join(config.dataDir, 'covers');

async function get(url: string, timeoutMs = 8000): Promise<Response | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? res : null;
  } catch {
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

async function dnbQuery(query: string, max: number): Promise<BookData[]> {
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
  const res = await get(`https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&recordSchema=MARC21-xml`
    + `&maximumRecords=1&query=${encodeURIComponent('num=' + isbn)}`);
  if (!res) return [];
  const xml = await res.text();
  const fields = (tag: string) => [...xml.matchAll(new RegExp(`<datafield tag="${tag}"[^>]*>([\\s\\S]*?)</datafield>`, 'g'))]
    .map(m => [...m[1].matchAll(/<subfield code="a">([^<]*)<\/subfield>/g)].map(x => decodeXml(x[1]).trim()));
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

type OlDoc = { title: string; author_name?: string[]; isbn?: string[]; cover_i?: number; first_publish_year?: number };

async function olSearch(q: string, max: number): Promise<SearchHit[]> {
  const res = await get(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${max}`
    + `&fields=title,author_name,isbn,cover_i,first_publish_year`);
  if (!res) return [];
  const docs = ((await res.json()).docs ?? []) as OlDoc[];
  return docs.map(d => {
    const isbns = (d.isbn ?? []).filter(i => i.length === 13);
    // deutsche Ausgabe bevorzugen, falls vorhanden
    const isbn = isbns.find(i => i.startsWith('9783')) ?? isbns[0] ?? null;
    return {
      isbn13: isbn, title: d.title, subtitle: null, authors: d.author_name ?? [], publisher: null,
      year: d.first_publish_year ?? null, pages: null, language: null, subjects: [], source: 'openlibrary',
      coverHint: d.cover_i ? { ol: d.cover_i } : isbn ? { isbn } : null
    };
  });
}

// ---------- öffentliche Funktionen ----------

/** Metadaten zu einer ISBN aus allen Quellen zusammenführen. */
export async function lookupIsbn(isbn13: string): Promise<BookData | null> {
  const [dnb, ol, genres] = await Promise.all([dnbQuery(`num=${isbn13}`, 1).then(r => r[0] ?? null), olByIsbn(isbn13), dnbGenres(isbn13)]);
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
    source: [dnb && 'dnb', ol && 'openlibrary'].filter(Boolean).join('+')
  };
}

export async function searchCatalog(q: string): Promise<SearchHit[]> {
  const words = q.trim().split(/\s+/).filter(w => w.length > 1).slice(0, 6);
  if (!words.length) return [];
  const dnbQ = words.map(w => `woe=${w.replace(/["=()<>]/g, '')}`).join(' and ') + ' and mat=books'; // ohne Hörbücher/Medien
  const [dnb, ol] = await Promise.all([dnbQuery(dnbQ, 15), olSearch(q, 15)]);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const h of [...dnb.map(b => ({ ...b, coverHint: b.isbn13 ? { isbn: b.isbn13 } : null })), ...ol]) {
    if (!h.isbn13) continue; // ohne ISBN nicht eindeutig importierbar – dafür gibt es die manuelle Erfassung
    if (seen.has(h.isbn13)) continue;
    seen.add(h.isbn13);
    hits.push(h);
  }
  // Relevanz: wie viele Suchwörter in Titel/Autor vorkommen; Treffer ohne Autor und Cover nach hinten
  const terms = words.map(w => w.toLowerCase());
  const score = (h: SearchHit) => {
    const hay = `${h.title} ${h.subtitle ?? ''} ${h.authors.join(' ')}`.toLowerCase();
    const title = h.title.toLowerCase();
    return terms.filter(t => hay.includes(t)).length * 10 + terms.filter(t => title.includes(t)).length * 3
      + (h.authors.length ? 2 : 0) + (h.coverHint?.ol ? 1 : 0);
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
  fs.copyFileSync(preview.file, path.join(coverDir, name));
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
