/**
 * Inhaltshinweise (Content Notes): Leser*innen markieren je Buch feste Schlagworte und können einen kurzen Text ergänzen.
 * Eine offene Datenquelle dafür gibt es nicht (StoryGraph und Trigger Warning Database haben keine API) – die Hinweise
 * entstehen deshalb innerhalb von bookshelv. Schlagworte zählen anonym über die ganze Instanz, Texte sieht man mit Namen
 * von sich und Freund*innen. Wer Schlagworte meiden will (prefs.avoidNotes), bekommt betroffene Cover verdeckt und
 * einen Hinweis auf der Buchseite.
 */
import { HTTPException } from 'hono/http-exception';
import { db } from '../db.ts';
import { friendSql } from '../friends.ts';
import { requireUser, type User } from '../auth.ts';
import { router, body, str, idParam, notFound } from '../util.ts';
import { getBook } from './books.ts';
import { avatarUrl } from './social.ts';

export const contentNoteRoutes = router();

export const NOTE_TAGS = ['violence', 'sexual_violence', 'abuse', 'child_abuse', 'domestic_violence', 'death', 'suicide', 'self_harm',
  'eating_disorder', 'drugs', 'alcohol', 'mental_illness', 'grief', 'terminal_illness', 'pregnancy_loss', 'war', 'torture', 'gore',
  'animal_harm', 'racism', 'queerphobia', 'misogyny', 'bullying', 'kidnapping', 'sexual_content'] as const;

const parseTags = (raw: string | null | undefined): string[] => {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.filter(x => (NOTE_TAGS as readonly string[]).includes(x)) : []; } catch { return []; }
};

/** zu meidende Schlagworte aus den Einstellungen (Komma-Liste in prefs.avoidNotes) */
export const avoidedTags = (u: User) => {
  try { return String((JSON.parse(u.prefs || '{}') as Record<string, string>).avoidNotes ?? '').split(',').filter(x => (NOTE_TAGS as readonly string[]).includes(x)); }
  catch { return []; }
};

/** Hinweise eines Buchs: Schlagworte mit Anzahl (wer nicht gesperrt ist), Texte von mir und Freund*innen */
export function notesOf(u: User, bookId: number) {
  const rows = db.prepare(`
    SELECT cn.user_id, cn.tags, cn.note, cn.updated_at, us.display_name, us.avatar,
           (cn.user_id = :me OR ${friendSql(u.id, 'cn.user_id')}) AS close
    FROM content_notes cn JOIN users us ON us.id = cn.user_id
    WHERE cn.book_id = :b AND us.disabled = 0
  `).all({ me: u.id, b: bookId }) as { user_id: number; tags: string; note: string | null; updated_at: string; display_name: string; avatar: string | null; close: number }[];
  const count = new Map<string, number>();
  for (const r of rows) for (const t of parseTags(r.tags)) count.set(t, (count.get(t) ?? 0) + 1);
  const mine = rows.find(r => r.user_id === u.id);
  const avoid = avoidedTags(u);
  return {
    tags: [...count.entries()].map(([tag, n]) => ({ tag, n, mine: !!mine && parseTags(mine.tags).includes(tag) })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)),
    notes: rows.filter(r => r.note && r.close).map(r => ({
      user: { id: r.user_id, displayName: r.display_name, avatarUrl: avatarUrl(r.avatar) }, text: r.note, updatedAt: r.updated_at, mine: r.user_id === u.id
    })),
    people: rows.filter(r => parseTags(r.tags).length).length,
    mine: mine ? { tags: parseTags(mine.tags), note: mine.note } : null,
    avoided: [...count.keys()].filter(t => avoid.includes(t))
  };
}

contentNoteRoutes.get('/content-notes/tags', c => c.json(NOTE_TAGS));

contentNoteRoutes.get('/books/:id/content-notes', c => {
  const u = requireUser(c);
  const id = idParam(c);
  if (!getBook(id)) throw notFound('Buch');
  return c.json(notesOf(u, id));
});

/** eigene Hinweise setzen; keine Schlagworte und kein Text = löschen */
contentNoteRoutes.put('/books/:id/content-notes', async c => {
  const u = requireUser(c);
  const id = idParam(c);
  if (!getBook(id)) throw notFound('Buch');
  const b = await body(c);
  if (b.tags !== undefined && !Array.isArray(b.tags)) throw new HTTPException(400, { message: 'Ungültige Anfrage (JSON erwartet)' });
  const bad = ((b.tags ?? []) as unknown[]).find(x => typeof x !== 'string' || !(NOTE_TAGS as readonly string[]).includes(x));
  if (bad !== undefined) throw new HTTPException(400, { message: `Erlaubt: ${NOTE_TAGS.join(', ')}` });
  const tags = [...new Set((b.tags ?? []) as string[])];
  const note = str(b.note, 500);
  if (!tags.length && !note) db.prepare('DELETE FROM content_notes WHERE user_id = ? AND book_id = ?').run(u.id, id);
  else db.prepare(`INSERT INTO content_notes (user_id, book_id, tags, note) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, book_id) DO UPDATE SET tags = excluded.tags, note = excluded.note, updated_at = datetime('now')`).run(u.id, id, JSON.stringify(tags), note);
  return c.json(notesOf(u, id));
});

/**
 * Bücher mit Schlagworten, die ich meiden will (für verdeckte Cover). Liefert Buch-IDs und Cover-Dateien,
 * weil viele Ansichten nur die Cover-URL kennen.
 */
contentNoteRoutes.get('/me/content-avoid', c => {
  const u = requireUser(c);
  const avoid = avoidedTags(u);
  if (!avoid.length) return c.json({ tags: [], books: [], covers: [] });
  // ohne json_each: das SQLite der Apps hat nicht sicher JSON1 – grob per LIKE vorfiltern, genau in JS prüfen
  const rows = (db.prepare(`
    SELECT b.id, b.cover, cn.tags FROM content_notes cn JOIN books b ON b.id = cn.book_id JOIN users us ON us.id = cn.user_id
    WHERE us.disabled = 0 AND (${avoid.map(() => 'cn.tags LIKE ?').join(' OR ')})
  `).all(...avoid.map(t => `%"${t}"%`)) as { id: number; cover: string | null; tags: string }[])
    .filter(r => parseTags(r.tags).some(t => avoid.includes(t)));
  const books = [...new Map(rows.map(r => [r.id, r])).values()];
  return c.json({ tags: avoid, books: books.map(r => r.id), covers: books.filter(r => r.cover).map(r => `/covers/${r.cover}`) });
});
