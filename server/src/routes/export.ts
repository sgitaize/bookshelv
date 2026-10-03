/**
 * CSV-Export für andere Dienste. Das Goodreads-Format ist der Quasi-Standard, den fast alle
 * Lese-Apps importieren (Booky, Book Tracker, BookBuddy, Bookmory, Hardcover, …); StoryGraph hat
 * ein eigenes Format. Leselisten werden zu „Bookshelves“ bzw. „Tags“.
 */
import { db } from '../db.ts';
import { requireUser } from '../auth.ts';
import { router, oneOf } from '../util.ts';

export const exportRoutes = router();

type Row = {
  id: number; isbn13: string | null; title: string; authors: string; publisher: string | null; year: number | null; pages: number | null;
  status: string | null; started_at: string | null; finished_at: string | null; rating: number | null; text: string | null; spoiler: number | null;
  owned_print: number; owned_ebook: number; binding: string | null; added_at: string | null; wish: number; lists: string | null;
};

/** Alle Bücher, mit denen ich etwas zu tun habe: Exemplar, Lesestand, Review, Wunschliste oder Leseliste */
function rowsOf(userId: number): Row[] {
  return db.prepare(`
    SELECT b.id, b.isbn13, b.title, b.authors, b.publisher, b.year, b.pages,
      ub.status, ub.started_at, ub.finished_at, r.rating, r.text, r.spoiler,
      (SELECT COUNT(*) FROM copies WHERE book_id = b.id AND owner_id = :u AND removed_at IS NULL AND format = 'print') AS owned_print,
      (SELECT COUNT(*) FROM copies WHERE book_id = b.id AND owner_id = :u AND removed_at IS NULL AND format = 'ebook') AS owned_ebook,
      (SELECT binding FROM copies WHERE book_id = b.id AND owner_id = :u AND removed_at IS NULL AND binding IS NOT NULL LIMIT 1) AS binding,
      (SELECT MIN(created_at) FROM copies WHERE book_id = b.id AND owner_id = :u) AS added_at,
      EXISTS (SELECT 1 FROM wishlist WHERE book_id = b.id AND user_id = :u) AS wish,
      (SELECT json_group_array(l.name) FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.book_id = b.id AND l.user_id = :u) AS lists
    FROM books b
    LEFT JOIN user_books ub ON ub.book_id = b.id AND ub.user_id = :u
    LEFT JOIN reviews r ON r.book_id = b.id AND r.user_id = :u
    WHERE ub.status IS NOT NULL AND ub.status != 'unread'
       OR r.id IS NOT NULL
       OR EXISTS (SELECT 1 FROM copies WHERE book_id = b.id AND owner_id = :u AND removed_at IS NULL)
       OR EXISTS (SELECT 1 FROM wishlist WHERE book_id = b.id AND user_id = :u)
       OR EXISTS (SELECT 1 FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.book_id = b.id AND l.user_id = :u)
    ORDER BY b.title COLLATE NOCASE
  `).all({ u: userId }) as Row[];
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
const ymd = (v: string | null, sep: string) => (v ? v.slice(0, 10).replace(/-/g, sep) : '');
const authorsOf = (r: Row) => JSON.parse(r.authors) as string[];
const listsOf = (r: Row) => (r.lists ? (JSON.parse(r.lists) as string[]) : []);

function goodreads(rows: Row[]) {
  const header = ['Book Id', 'Title', 'Author', 'Author l-f', 'Additional Authors', 'ISBN', 'ISBN13', 'My Rating', 'Average Rating', 'Publisher',
    'Binding', 'Number of Pages', 'Year Published', 'Original Publication Year', 'Date Read', 'Date Added', 'Bookshelves',
    'Bookshelves with positions', 'Exclusive Shelf', 'My Review', 'Spoiler', 'Private Notes', 'Read Count', 'Owned Copies'];
  return csv(header, rows.map(r => {
    const [first, ...more] = authorsOf(r);
    const parts = (first ?? '').split(' ');
    const lf = parts.length > 1 ? `${parts.at(-1)}, ${parts.slice(0, -1).join(' ')}` : first ?? '';
    const shelf = r.status === 'read' ? 'read' : r.status === 'reading' ? 'currently-reading' : r.status === 'dnf' ? 'did-not-finish' : 'to-read';
    const isbn10 = r.isbn13?.startsWith('978') ? isbn13to10(r.isbn13) : '';
    const binding = r.owned_print ? (r.binding === 'hardcover' ? 'Hardcover' : r.binding === 'paperback' ? 'Paperback' : '') : r.owned_ebook ? 'Kindle Edition' : '';
    return [r.id, r.title, first ?? '', lf, more.join(', '), isbn10 ? `="${isbn10}"` : '', r.isbn13 ? `="${r.isbn13}"` : '',
      r.rating ? Math.round(r.rating) : 0, '', r.publisher ?? '', binding, r.pages ?? '', r.year ?? '', r.year ?? '',
      ymd(r.finished_at, '/'), ymd(r.added_at, '/'), listsOf(r).map(slug).join(', '), '', shelf,
      r.text ?? '', r.spoiler ? 'true' : '', '', r.status === 'read' ? 1 : 0, r.owned_print + r.owned_ebook];
  }));
}

function storygraph(rows: Row[]) {
  const header = ['Title', 'Authors', 'Contributors', 'ISBN/UID', 'Format', 'Read Status', 'Date Added', 'Last Date Read', 'Dates Read',
    'Read Count', 'Moods', 'Pace', 'Character- or Plot-Driven?', 'Strong Character Development?', 'Loveable Characters?',
    'Diverse Characters?', 'Flawed Characters?', 'Star Rating', 'Review', 'Content Warnings', 'Content Warning Description', 'Tags', 'Owned?'];
  return csv(header, rows.map(r => {
    const status = r.status === 'read' ? 'read' : r.status === 'reading' ? 'currently-reading' : r.status === 'dnf' ? 'did-not-finish' : 'to-read';
    const format = r.owned_print ? (r.binding ?? 'paperback') : r.owned_ebook ? 'digital' : '';
    const dates = r.started_at && r.finished_at ? `${ymd(r.started_at, '/')}-${ymd(r.finished_at, '/')}` : '';
    return [r.title, authorsOf(r).join(', '), '', r.isbn13 ?? '', format, status, ymd(r.added_at, '/'), ymd(r.finished_at, '/'), dates,
      r.status === 'read' ? 1 : 0, '', '', '', '', '', '', '', r.rating ?? '', r.text ?? '', '', '', listsOf(r).join(', '), r.owned_print || r.owned_ebook ? 'Yes' : 'No'];
  }));
}

/** Schlichte, gut lesbare Tabelle (auch für Excel/Numbers und Apps mit Spaltenzuordnung) */
function simple(rows: Row[]) {
  const header = ['title', 'authors', 'isbn13', 'publisher', 'year', 'pages', 'status', 'started', 'finished', 'rating', 'review',
    'owned', 'format', 'binding', 'added', 'wishlist', 'lists'];
  return csv(header, rows.map(r => [r.title, authorsOf(r).join(', '), r.isbn13 ?? '', r.publisher ?? '', r.year ?? '', r.pages ?? '',
    r.status ?? (r.wish ? 'want' : 'unread'), r.started_at ?? '', r.finished_at ?? '', r.rating ?? '', r.text ?? '',
    r.owned_print || r.owned_ebook ? 'yes' : 'no', r.owned_print && r.owned_ebook ? 'print+ebook' : r.owned_ebook ? 'ebook' : r.owned_print ? 'print' : '',
    r.binding ?? '', ymd(r.added_at, '-'), r.wish ? 'yes' : 'no', listsOf(r).join('; ')]));
}

function isbn13to10(isbn13: string) {
  const core = isbn13.slice(3, 12);
  const sum = [...core].reduce((s, d, i) => s + Number(d) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

exportRoutes.get('/me/export.csv', c => {
  const u = requireUser(c);
  const format = oneOf(c.req.query('format'), ['goodreads', 'storygraph', 'simple'] as const, 'goodreads');
  const rows = rowsOf(u.id);
  const text = format === 'goodreads' ? goodreads(rows) : format === 'storygraph' ? storygraph(rows) : simple(rows);
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="bookshelv-${u.username}-${format}.csv"`);
  // BOM, damit Excel Umlaute richtig liest
  return c.body('﻿' + text);
});
