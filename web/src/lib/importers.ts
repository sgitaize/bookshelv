/**
 * CSV-Exporte anderer Dienste in einheitliche Import-Einträge umwandeln (läuft komplett im Browser).
 * Unterstützt: Goodreads ("Export Library"), StoryGraph ("Export"), einfache CSV mit title/author/isbn.
 */

export type ImportItem = {
  isbn?: string; title?: string; authors?: string[]; status: 'read' | 'reading' | 'unread' | 'dnf' | 'want';
  rating?: number | null; review?: string | null; spoiler?: boolean; finishedAt?: string | null; addedAt?: string | null;
  owned?: boolean; format?: 'print' | 'ebook'; binding?: 'paperback' | 'hardcover' | null;
};

export type ImportSource = 'goodreads' | 'storygraph' | 'generic';

/** RFC-4180-CSV: Anführungszeichen, verdoppelte "" und Zeilenumbrüche in Feldern */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
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
const dateOf = (v: string | undefined) => {
  const m = (v ?? '').match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};
const authorsOf = (...vals: (string | undefined)[]) =>
  vals.flatMap(v => (v ?? '').split(',')).map(a => a.trim()).filter(Boolean);
const stripHtml = (v: string | undefined) =>
  (v ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim() || null;

export function detect(header: string[]): ImportSource {
  const h = header.map(x => x.trim().toLowerCase());
  if (h.includes('exclusive shelf')) return 'goodreads';
  if (h.includes('read status') && h.includes('star rating')) return 'storygraph';
  return 'generic';
}

export function convert(rows: string[][]): { source: ImportSource; items: ImportItem[] } {
  const [header, ...data] = rows;
  if (!header) return { source: 'generic', items: [] };
  const source = detect(header);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const get = (r: string[], name: string) => (idx[name] !== undefined ? r[idx[name]]?.trim() : undefined);

  const items = data.map((r): ImportItem | null => {
    if (source === 'goodreads') {
      const shelf = get(r, 'exclusive shelf');
      const binding = (get(r, 'binding') ?? '').toLowerCase();
      const ebook = /kindle|ebook|e-book|digital/.test(binding);
      return {
        isbn: isbnOf(get(r, 'isbn13')) ?? isbnOf(get(r, 'isbn')),
        // Reihenangabe "(Dune, #1)" am Ende entfernen
        title: (get(r, 'title') ?? '').replace(/\s*\([^()]*#\d+(\.\d+)?\)\s*$/, ''),
        authors: authorsOf(get(r, 'author'), get(r, 'additional authors')),
        status: shelf === 'read' ? 'read' : shelf === 'currently-reading' ? 'reading' : shelf === 'to-read' ? 'want' : 'unread',
        rating: Number(get(r, 'my rating')) || null,
        review: stripHtml(get(r, 'my review')),
        spoiler: get(r, 'spoiler') === 'true',
        finishedAt: dateOf(get(r, 'date read')),
        addedAt: dateOf(get(r, 'date added')),
        owned: Number(get(r, 'owned copies')) > 0,
        format: ebook ? 'ebook' : 'print',
        binding: ebook ? null : binding.includes('hardcover') ? 'hardcover' : binding.includes('paperback') ? 'paperback' : null
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
        format: format === 'digital' ? 'ebook' : 'print',
        binding: format === 'hardcover' ? 'hardcover' : format === 'paperback' ? 'paperback' : null
      };
    }
    // einfache CSV: Spalten title/titel, author/autor, isbn
    const title = get(r, 'title') ?? get(r, 'titel');
    const isbn = isbnOf(get(r, 'isbn') ?? get(r, 'isbn13'));
    if (!title && !isbn) return null;
    return { isbn, title, authors: authorsOf(get(r, 'author') ?? get(r, 'autor') ?? get(r, 'authors')), status: 'unread', owned: true, format: 'print' };
  });
  return { source, items: items.filter((x): x is ImportItem => !!x && !!(x.title || x.isbn)) };
}
