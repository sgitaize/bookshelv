/**
 * CSV-Exporte anderer Dienste in einheitliche Import-Einträge umwandeln (läuft komplett im Browser).
 * Unterstützt: Goodreads ("Export Library"), StoryGraph ("Export"), einfache CSV mit title/author/isbn.
 */

export type ImportItem = {
  isbn?: string; title?: string; authors?: string[]; status: 'read' | 'reading' | 'unread' | 'dnf' | 'want';
  rating?: number | null; review?: string | null; spoiler?: boolean; finishedAt?: string | null; addedAt?: string | null;
  owned?: boolean; format?: 'print' | 'ebook' | 'audio'; binding?: 'paperback' | 'hardcover' | null; startedAt?: string | null;
  lists?: (string | ListRef)[]; resolve?: string[]; favorite?: boolean; wishlist?: boolean; dateUnknown?: boolean;
  /** nur Booky, nur im Browser: alle Listen des Buchs (für die Auswahl je Liste), wird vor dem Hochladen entfernt */
  booky?: { key: string; refs: (ListRef & { std?: string })[] };
};
export type ListRef = { name: string; createdAt?: string | null; addedAt?: string | null };

export type ImportSource = 'goodreads' | 'storygraph' | 'booky' | 'bookshelv' | 'generic';

/** RFC-4180-CSV: Anführungszeichen, verdoppelte "" und Zeilenumbrüche in Feldern */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  // Trennzeichen aus der Kopfzeile: deutsche Apps/Excel nehmen oft ";", manche Tabulator
  const head = s.slice(0, s.search(/\r|\n|$/));
  const count = (ch: string) => head.split(ch).length;
  const sep = count(';') > count(',') && count(';') >= count('\t') ? ';' : count('\t') > count(',') ? '\t' : ',';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

const isbnOf = (v: string | undefined) => (v ?? '').replace(/[^0-9Xx]/g, '') || undefined;
/** "2024/03/17" oder "2024-03-17" → "2024-03-17" */
export const dateOf = (v: string | undefined) => {
  const t = (v ?? '').trim();
  let m = t.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // 17.03.2024 (deutsch) bzw. 03/17/2024 (US)
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Number(m[1]) > 12 ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
};
const authorsOf = (...vals: (string | undefined)[]) =>
  vals.flatMap(v => (v ?? '').split(',')).map(a => a.trim()).filter(Boolean);
const stripHtml = (v: string | undefined) =>
  (v ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim() || null;

export function detect(header: string[]): ImportSource {
  const h = header.map(x => x.trim().toLowerCase());
  if (h.includes('exclusive shelf')) return 'goodreads';
  if (h.includes('read status') && h.includes('star rating')) return 'storygraph';
  if (['isbn', 'title', 'contributors', 'list_name', 'is_default', 'entry_created_at'].every(x => h.includes(x))) return 'booky';
  if (['title', 'isbn13', 'status', 'rating', 'owned', 'wishlist', 'lists'].every(x => h.includes(x))) return 'bookshelv';
  return 'generic';
}

export function convert(rows: string[][]): { source: ImportSource; items: ImportItem[] } {
  const [header, ...data] = rows;
  if (!header) return { source: 'generic', items: [] };
  const source = detect(header);
  if (source === 'booky') return { source, items: fromBooky(header, data) };
  const idx = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const get = (r: string[], name: string) => (idx[name] !== undefined ? r[idx[name]]?.trim() : undefined);
  const mapping = guessMapping(header);
  const scale = ratingScale(data, mapping.rating);

  const items = data.map((r): ImportItem | null => {
    if (source === 'goodreads') {
      const shelf = get(r, 'exclusive shelf');
      const binding = (get(r, 'binding') ?? '').toLowerCase();
      const ebook = /kindle|ebook|e-book|digital/.test(binding);
      const audio = /audio|hörbuch|mp3/.test(binding);
      return {
        isbn: isbnOf(get(r, 'isbn13')) ?? isbnOf(get(r, 'isbn')),
        // Reihenangabe "(Dune, #1)" am Ende entfernen
        title: (get(r, 'title') ?? '').replace(/\s*\([^()]*#\d+(\.\d+)?\)\s*$/, ''),
        authors: authorsOf(get(r, 'author'), get(r, 'additional authors')),
        status: shelf === 'read' ? 'read' : shelf === 'currently-reading' ? 'reading' : shelf === 'to-read' ? 'want' : shelf === 'did-not-finish' ? 'dnf' : 'unread',
        // weitere (nicht exklusive) Regale werden zu Leselisten
        lists: (get(r, 'bookshelves') ?? '').split(',').map(x => x.trim()).filter(x => x && !['read', 'currently-reading', 'to-read', 'did-not-finish', 'favorites'].includes(x)),
        rating: Number(get(r, 'my rating')) || null,
        review: stripHtml(get(r, 'my review')),
        spoiler: get(r, 'spoiler') === 'true',
        finishedAt: dateOf(get(r, 'date read')),
        addedAt: dateOf(get(r, 'date added')),
        owned: Number(get(r, 'owned copies')) > 0,
        format: audio ? 'audio' : ebook ? 'ebook' : 'print',
        binding: ebook || audio ? null : binding.includes('hardcover') ? 'hardcover' : binding.includes('paperback') ? 'paperback' : null
      };
    }
    if (source === 'storygraph') {
      const st = (get(r, 'read status') ?? '').toLowerCase();
      const format = (get(r, 'format') ?? '').toLowerCase();
      return {
        isbn: isbnOf(get(r, 'isbn/uid')),
        title: get(r, 'title'),
        authors: authorsOf(get(r, 'authors')),
        status: st === 'read' ? 'read' : st === 'currently-reading' ? 'reading' : st === 'to-read' ? 'want' : st === 'did-not-finish' ? 'dnf' : 'unread',
        rating: Number(get(r, 'star rating')) || null,
        review: stripHtml(get(r, 'review')),
        finishedAt: dateOf(get(r, 'last date read')),
        addedAt: dateOf(get(r, 'date added')),
        owned: (get(r, 'owned?') ?? '').toLowerCase() === 'yes',
        format: format === 'digital' ? 'ebook' : format === 'audio' ? 'audio' : 'print',
        binding: format === 'hardcover' ? 'hardcover' : format === 'paperback' ? 'paperback' : null
      };
    }
    return fromMapping(r, mapping, scale);
  });
  return { source, items: items.filter((x): x is ImportItem => !!x && !!(x.title || x.isbn)) };
}

// ---------- Beliebige CSV (Booky, BookBuddy, Book Tracker, Excel-Listen …) per Spaltenzuordnung ----------

export const FIELDS = ['title', 'authors', 'isbn', 'status', 'rating', 'review', 'finished', 'started', 'added', 'owned', 'format', 'lists'] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Record<Field, number>;

/** Übliche Spaltennamen (klein, ohne Sonderzeichen) – deutsch und englisch */
const ALIASES: Record<Field, string[]> = {
  title: ['title', 'titel', 'booktitle', 'buchtitel', 'name'],
  authors: ['authors', 'author', 'autor', 'autoren', 'autorin', 'verfasser', 'writer', 'authorname'],
  isbn: ['isbn13', 'isbn', 'isbn10', 'isbnuid', 'ean', 'barcode'],
  status: ['status', 'readstatus', 'readingstatus', 'lesestatus', 'lesestand', 'shelf', 'exclusiveshelf', 'regal', 'state', 'gelesen'],
  rating: ['rating', 'myrating', 'starrating', 'stars', 'bewertung', 'meinebewertung', 'sterne', 'score', 'rate'],
  review: ['review', 'myreview', 'rezension', 'kritik', 'notes', 'notizen', 'comment', 'kommentar', 'meinung'],
  finished: ['finished', 'dateread', 'datefinished', 'finishdate', 'enddate', 'lastdateread', 'gelesenam', 'beendet', 'beendetam', 'ende', 'readdate', 'fertig'],
  started: ['started', 'datestarted', 'startdate', 'begonnen', 'begonnenam', 'start', 'angefangen'],
  added: ['added', 'dateadded', 'hinzugefuegt', 'hinzugefugt', 'hinzugefuegtam', 'createdat', 'erstellt', 'angelegt'],
  owned: ['owned', 'ownedcopies', 'owned?', 'besitz', 'imbesitz', 'besessen', 'library', 'bibliothek'],
  format: ['format', 'binding', 'einband', 'type', 'typ', 'medium'],
  lists: ['lists', 'listen', 'bookshelves', 'tags', 'collections', 'sammlung', 'sammlungen', 'leselisten', 'shelves']
};
const norm = (h: string) => h.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9?]/g, '').replace(/\?$/, '');

export function guessMapping(header: string[]): Mapping {
  const h = header.map(norm);
  const used = new Set<number>();
  const m = {} as Mapping;
  for (const f of FIELDS) {
    // exakter Treffer in Alias-Reihenfolge, sonst "enthält"
    let i = -1;
    for (const a of ALIASES[f]) { i = h.findIndex((x, j) => !used.has(j) && x === norm(a)); if (i >= 0) break; }
    if (i < 0 && f !== 'status' && f !== 'format') for (const a of ALIASES[f]) { i = h.findIndex((x, j) => !used.has(j) && a.length > 4 && x.includes(norm(a))); if (i >= 0) break; }
    m[f] = i;
    if (i >= 0) used.add(i);
  }
  return m;
}

/** Höchster vorkommender Wert der Bewertungsspalte → Skala (5, 10 oder 100) */
export function ratingScale(data: string[][], col: number) {
  if (col < 0) return 5;
  const max = Math.max(0, ...data.map(r => Number((r[col] ?? '').replace(',', '.').replace(/[^\d.]/g, '')) || 0));
  // ★★★★☆ zählt über die Sterne, nicht als Zahl
  return max > 10 ? 100 : max > 5 ? 10 : 5;
}

const statusOf = (v: string): ImportItem['status'] => {
  const s = v.toLowerCase().trim();
  if (!s) return 'unread';
  if (/did.?not.?finish|dnf|abgebrochen|aufgegeben|abandon/.test(s)) return 'dnf';
  if (/currently|reading|lese ich|am lesen|lesend|in progress|in arbeit|begonnen|aktuell|^lese/.test(s)) return 'reading';
  if (/to.?read|want|wunsch|tbr|will lesen|möchte|moechte|später|merkliste|wishlist|ungelesen geplant|planned/.test(s)) return 'want';
  if (/^(read|gelesen|finished|done|fertig|beendet|completed|ja|yes|true|1|x)$|^gelesen|^read$/.test(s)) return 'read';
  return 'unread';
};
const yes = (v: string) => /^(yes|ja|true|1|x|y|owned|besessen|vorhanden|✓|✔)$/i.test(v.trim()) || Number(v) > 0;

export function fromMapping(r: string[], m: Mapping, scale = 5): ImportItem | null {
  const g = (f: Field) => (m[f] >= 0 ? (r[m[f]] ?? '').trim() : '');
  const title = g('title') || undefined;
  const isbn = isbnOf(g('isbn'));
  if (!title && !isbn) return null;
  const rawRating = g('rating');
  const stars = (rawRating.match(/★/g) ?? []).length + ((rawRating.match(/½/g) ?? []).length ? 0.5 : 0);
  const num = Number(rawRating.replace(',', '.').replace(/[^\d.]/g, '')) || 0;
  const rating = stars || (num ? Math.round((num / scale) * 5 * 2) / 2 : 0);
  const fmt = g('format').toLowerCase();
  const ebook = /e-?book|kindle|digital|epub|tolino|kobo/.test(fmt);
  const audio = /audio|hörbuch|audible|mp3|cd/.test(fmt);
  const status = statusOf(g('status')) === 'unread' && g('finished') ? 'read' : statusOf(g('status'));
  return {
    isbn, title, authors: authorsOf(g('authors').replace(/;| & | und | and /g, ',')),
    status,
    rating: rating >= 0.5 ? Math.min(5, rating) : null,
    review: stripHtml(g('review')),
    finishedAt: dateOf(g('finished')),
    startedAt: dateOf(g('started')),
    addedAt: dateOf(g('added')),
    owned: m.owned >= 0 ? yes(g('owned')) : true,
    format: audio ? 'audio' : ebook ? 'ebook' : 'print',
    binding: ebook || audio ? null : /hard|gebunden|hc/.test(fmt) ? 'hardcover' : /paper|taschen|tb|softcover|broschiert/.test(fmt) ? 'paperback' : null,
    lists: g('lists').split(g('lists').includes(';') ? ';' : /[,|]/).map(x => x.trim()).filter(Boolean)
  };
}

/** Beliebige CSV mit vom Nutzer angepasster Zuordnung umwandeln */
export function convertMapped(rows: string[][], m: Mapping): ImportItem[] {
  const [, ...data] = rows;
  const scale = ratingScale(data, m.rating);
  return data.map(r => fromMapping(r, m, scale)).filter((x): x is ImportItem => !!x);
}

// ---------- Booky ----------

/** Booky-Standardlisten → bookshelv. Alles andere sind eigene Listen und werden Leselisten. */
export const BOOKY_DEFAULTS: Record<string, string> = {
  finished: 'read', currently_reading: 'reading', did_not_finish: 'dnf',
  want_to_read: 'want_to_read', wishlist: 'wishlist', favorite: 'favorite'
};
/** Booky trägt „Datum unbekannt“ als 2000-01-01 ein */
const bookyDate = (v: string | undefined) => (v && !v.startsWith('2000-01-01') ? v.slice(0, 19) : null);

/**
 * Booky exportiert eine Zeile je Buch und Liste (isbn, title, contributors, list_name, is_default,
 * list_created_at, entry_created_at). Hier wird daraus ein Eintrag je Buch.
 * entry_created_at der Liste „finished“ = gelesen am, bei „currently_reading“ = begonnen am.
 */
export function fromBooky(header: string[], data: string[][]): ImportItem[] {
  const i = Object.fromEntries(header.map((h, n) => [h.trim().toLowerCase(), n]));
  const byBook = new Map<string, ImportItem & { owned: boolean }>();
  for (const r of data) {
    const isbn = isbnOf(r[i.isbn]);
    const title = (r[i.title] ?? '').trim();
    if (!isbn && !title) continue;
    const key = isbn ?? title.toLowerCase();
    const it = byBook.get(key) ?? { isbn, title, authors: authorsOf(r[i.contributors]), status: 'unread', owned: false, format: 'print', lists: [], booky: { key, refs: [] } };
    byBook.set(key, it);
    const list = (r[i.list_name] ?? '').trim();
    const isDefault = (r[i.is_default] ?? '').toLowerCase() === 'true';
    const entry = bookyDate(r[i.entry_created_at]);
    const kind = isDefault ? BOOKY_DEFAULTS[list] : undefined;
    if (list) it.booky!.refs.push({ name: list, createdAt: bookyDate(r[i.list_created_at]), addedAt: entry, ...(isDefault && kind ? { std: list } : {}) });
    if (kind === 'read' || kind === 'dnf') {
      // gelesen schlägt alles andere; mehrfach gelesen → letztes Datum
      if (it.status !== 'read' || kind === 'read') it.status = kind;
      const d = entry?.slice(0, 10) ?? null;
      if (d && (!it.finishedAt || d > it.finishedAt)) it.finishedAt = d;
      if (!d && !it.finishedAt) it.dateUnknown = true;
      if (d) it.dateUnknown = false;
    } else if (kind === 'reading') {
      if (it.status !== 'read' && it.status !== 'dnf') it.status = 'reading';
      it.startedAt = entry?.slice(0, 10) ?? null;
    } else if (kind === 'wishlist') {
      it.wishlist = true;
    } else if (kind === 'favorite') {
      it.favorite = true;
    } else if (list) {
      // want_to_read wird zur Leseliste „Will ich lesen“, eigene Listen behalten ihren Namen
      const name = kind === 'want_to_read' ? 'Will ich lesen' : list;
      it.lists!.push({ name, createdAt: bookyDate(r[i.list_created_at]), addedAt: entry });
    }
    if (entry && (!it.addedAt || entry.slice(0, 10) < it.addedAt)) it.addedAt = entry.slice(0, 10);
  }
  // nur auf der Wunschliste → status want (kein Exemplar)
  for (const it of byBook.values()) if (it.wishlist && it.status === 'unread' && !it.lists!.length) it.status = 'want';
  return [...byBook.values()];
}

/** Listen-/Regalnamen eines Imports (für die Auswahl „steht in meinem Regal“) */
export const listNames = (items: ImportItem[]) =>
  [...new Set(items.flatMap(it => (it.lists ?? []).map(l => (typeof l === 'string' ? l : l.name))))];

// ---------- Booky: Auswahl je Liste ----------

/** Was mit den Büchern einer Booky-Liste passiert: Besitz (alle / einzeln angetippt), Wunschliste oder nichts */
export type BookyTarget = 'all' | 'pick' | 'wish' | 'none';
export type BookyPlan = {
  target: BookyTarget; format: 'print' | 'ebook';
  /** als Leseliste mit diesem Namen anlegen (bzw. in die gleichnamige Liste einfügen) */
  list: boolean; name: string;
  /** Lesestand für Bücher, die Booky nicht als gelesen/am Lesen/abgebrochen führt */
  status: 'auto' | 'unread' | 'reading' | 'read' | 'dnf';
  /** bei target 'pick': Schlüssel der Bücher, die im Regal stehen */
  picked: string[];
};
export type BookyRow = { id: string; name: string; std?: string; count: number };

/** Standardlisten in dieser Reihenfolge, danach eigene Listen nach Größe; Favoriten werden nur ♥ */
const STD_ORDER = ['want_to_read', 'finished', 'currently_reading', 'did_not_finish', 'wishlist'];
export const bookyRowId = (r: { name: string; std?: string }) => (r.std ? `std:${r.std}` : `list:${r.name}`);

export function bookyRows(items: ImportItem[]): BookyRow[] {
  const rows = new Map<string, BookyRow>();
  for (const it of items) for (const r of it.booky?.refs ?? []) {
    if (r.std === 'favorite') continue;
    const id = bookyRowId(r);
    const row = rows.get(id) ?? { id, name: r.name, std: r.std, count: 0 };
    row.count++; rows.set(id, row);
  }
  const rank = (r: BookyRow) => (r.std ? STD_ORDER.indexOf(r.std) : STD_ORDER.length);
  return [...rows.values()].sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.name.localeCompare(b.name));
}

/** Vorschlag je Liste; „Will ich lesen“ heißt in Booky „Stapel ungelesener Bücher“ und steht im Regal */
export function bookyDefaultPlan(row: BookyRow): BookyPlan {
  const plan: BookyPlan = { target: 'none', format: /e-?books?/i.test(row.name) ? 'ebook' : 'print', list: !row.std, name: row.name, status: 'auto', picked: [] };
  if (row.std === 'want_to_read') return { ...plan, target: 'all', list: true, name: 'Stapel ungelesener Bücher' };
  if (row.std === 'finished') return { ...plan, target: 'pick' };
  if (row.std === 'currently_reading') return { ...plan, target: 'all' };
  if (row.std === 'wishlist') return { ...plan, target: 'wish' };
  if (row.std) return plan;
  if (/wunsch|geburtstag|weihnacht|geschenk/i.test(row.name)) return { ...plan, target: 'wish' };
  if (/stapel|ungelesen|sub\b/i.test(row.name)) return { ...plan, target: 'all' };
  // unklar → nachfragen: einzeln antippen, nichts vorausgewählt
  return { ...plan, target: 'pick' };
}

const RANK = { unread: 1, reading: 2, dnf: 3, read: 4 } as const;

/**
 * Wendet die Auswahl je Liste an. Regeln (Simon, 2026-10-04):
 * Besitz gewinnt über Wunschliste; Gelesenes kommt nie auf die Wunschliste; der Lesestand aus Booky
 * (gelesen/am Lesen/abgebrochen) gilt, sonst der höchste Lesestand, den eine Liste vorgibt.
 */
export function applyBookyPlans(items: ImportItem[], plans: Record<string, BookyPlan>): ImportItem[] {
  return items.map(({ booky, ...it }) => {
    if (!booky) return it;
    const rows = booky.refs.map(r => ({ r, p: plans[bookyRowId(r)] })).filter(x => x.p);
    const owning = rows.filter(x => x.p.target === 'all' || (x.p.target === 'pick' && x.p.picked.includes(booky.key)));
    const owned = owning.length > 0;
    let status: ImportItem['status'] = it.status === 'want' ? 'unread' : it.status;
    if (status === 'unread') {
      for (const { p } of rows) if (p.status !== 'auto' && RANK[p.status] > RANK[status as keyof typeof RANK]) status = p.status;
    }
    const wishlist = !owned && status !== 'read' && rows.some(x => x.p.target === 'wish');
    if (!owned && wishlist && status === 'unread') status = 'want';
    const lists = rows.filter(x => x.p.list && x.p.name.trim())
      .map(({ r, p }) => ({ name: p.name.trim(), createdAt: r.createdAt, addedAt: r.addedAt }));
    return {
      ...it, status, owned, wishlist, lists,
      format: owned && owning.every(x => x.p.format === 'ebook') ? 'ebook' : 'print',
      dateUnknown: status === 'read' && !it.finishedAt ? true : it.dateUnknown
    };
  });
}
