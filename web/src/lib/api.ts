export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Fehler ${res.status}`, data);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body)
};

// ---------- Typen ----------

export type Me = { id: number; username: string; displayName: string; isAdmin: boolean; shelfVisible: boolean; createdAt: string };

export type Book = {
  id: number; isbn13: string | null; title: string; subtitle: string | null; authors: string[];
  publisher: string | null; year: number | null; pages: number | null; language: string | null; subjects: string[]; coverUrl: string | null;
};

export type Format = 'print' | 'ebook';
export type Binding = 'paperback' | 'hardcover';
export type ReadStatus = 'unread' | 'reading' | 'read' | 'dnf';

export type CopyValues = { format: Format; binding: Binding | null; sprayedEdges: boolean; readStatus: ReadStatus; notes: string };
export const emptyCopy = (): CopyValues => ({ format: 'print', binding: null, sprayedEdges: false, readStatus: 'unread', notes: '' });

export type BookBrief = Pick<Book, 'id' | 'title' | 'subtitle' | 'authors' | 'year' | 'pages' | 'coverUrl'>;

export type ShelfItem = {
  id: number; format: Format; binding: Binding | null; sprayedEdges: boolean; readStatus: ReadStatus;
  progress: number | null; favorite: boolean; createdAt: string; lent: boolean;
  book: BookBrief;
};

export type Reading = { status: ReadStatus; progress: number | null; startedAt: string | null; finishedAt: string | null; favorite: boolean };
export type ReadingItem = { book: BookBrief; status: ReadStatus; progress: number | null; startedAt: string | null; finishedAt: string | null };

export type Home = {
  reading: ReadingItem[]; recentlyRead: ReadingItem[]; toRead: ShelfItem[]; toReadCount: number; recentlyAdded: ShelfItem[];
  counts: { books: number; read: number; readThisYear: number };
};

export type Profile = {
  id: number; username: string; displayName: string; createdAt: string; shelfVisible: boolean;
  counts: { books: number; read: number; readThisYear: number };
  favorites: BookBrief[]; reading: BookBrief[];
};

export type Copy = {
  id: number; format: Format; binding: Binding | null; sprayedEdges: boolean; readStatus: ReadStatus;
  notes: string | null; createdAt: string; ownerId: number; ownerName: string; mine: boolean;
};

export type SearchHit = {
  isbn13: string; title: string; subtitle: string | null; authors: string[]; publisher: string | null;
  year: number | null; bookId: number | null; coverUrl: string | null;
};

export type Invite = { id: number; token: string; note: string | null; createdAt: string; expiresAt: string; usedAt: string | null; usedBy: string | null; createdBy?: string };

export const labels = {
  format: { print: 'Gedruckt', ebook: 'E-Book' } as Record<Format, string>,
  binding: { paperback: 'Taschenbuch', hardcover: 'Hardcover' } as Record<Binding, string>,
  read: { unread: 'Ungelesen', reading: 'Am Lesen', read: 'Gelesen', dnf: 'Abgebrochen' } as Record<ReadStatus, string>
};

/** Fortschritt in Prozent; ohne bekannte Seitenzahl wird der Fortschritt selbst als Prozentwert gespeichert */
export const percent = (progress: number | null, pages: number | null) =>
  progress ? Math.min(100, Math.round((progress / (pages || 100)) * 100)) : 0;

export const inviteUrl = (token: string) => `${location.origin}/invite/${token}`;
