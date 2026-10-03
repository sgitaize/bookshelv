import { t, i18n } from './i18n.svelte.ts';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  // Schreibende Anfragen immer als JSON – sonst lehnt der CSRF-Schutz sie ab (z. B. DELETE ohne Inhalt)
  const json = method !== 'GET';
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'x-lang': i18n.lang, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(body ?? {}) : undefined,
    credentials: 'same-origin'
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? t('common.error', { n: res.status }), data);
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

export type Me = { id: number; username: string; displayName: string; isAdmin: boolean; shelfVisible: boolean; createdAt: string; avatarUrl: string | null };

export type Book = {
  id: number; isbn13: string | null; title: string; subtitle: string | null; authors: string[];
  publisher: string | null; year: number | null; pages: number | null; language: string | null; subjects: string[]; coverUrl: string | null;
};

export type Format = 'print' | 'ebook';
export type Binding = 'paperback' | 'hardcover';
export type ReadStatus = 'unread' | 'reading' | 'read' | 'dnf';

export type CopyValues = { format: Format; binding: Binding | null; sprayedEdges: boolean; readStatus: ReadStatus; notes: string; storeId: number | null };
export const emptyCopy = (): CopyValues => ({ format: 'print', binding: null, sprayedEdges: false, readStatus: 'unread', notes: '', storeId: null });
export type Store = { id: number; name: string };

export type BookBrief = Pick<Book, 'id' | 'title' | 'subtitle' | 'authors' | 'year' | 'pages' | 'coverUrl'>;

export type ShelfItem = {
  id: number; format: Format; binding: Binding | null; sprayedEdges: boolean; readStatus: ReadStatus;
  progress: number | null; favorite: boolean; createdAt: string; lent: boolean;
  store?: string | null; storeId?: number | null;
  removedAt?: string | null; removedReason?: RemoveReason | null;
  book: BookBrief;
};

export type RemoveReason = 'sold' | 'given_away' | 'lost' | 'other';
export type ArchivedCopy = { id: number; format: Format; binding: Binding | null; removedAt: string; removedReason: RemoveReason | null };

export type Reading = { status: ReadStatus; progress: number | null; startedAt: string | null; finishedAt: string | null; favorite: boolean };
export type ReadingItem = { book: BookBrief; status: ReadStatus; progress: number | null; startedAt: string | null; finishedAt: string | null };

export type Home = {
  reading: ReadingItem[]; recentlyRead: ReadingItem[]; toRead: ShelfItem[]; toReadCount: number; recentlyAdded: ShelfItem[];
  counts: { books: number; read: number; readThisYear: number };
};

export type Visibility = 'private' | 'instance' | 'federated';
export type ReviewComment = { id: number; text: string; createdAt: string; user: { id: number; displayName: string; avatarUrl: string | null }; canDelete: boolean };
export type Review = {
  id: number; bookId: number; rating: number | null; text: string | null; visibility: Visibility; spoiler: boolean;
  createdAt: string; updatedAt: string; mine: boolean; user: { id: number; displayName: string; username: string; avatarUrl: string | null };
  comments: ReviewComment[];
};
export type RemoteReview = { id: number; rating: number | null; text: string | null; spoiler: boolean; createdAt: string; updatedAt: string; user: { displayName: string; handle: string; instance: string | null } };
export type BookReviews = { average: number | null; count: number; reviews: Review[]; remote: RemoteReview[] };
export type RecentReview = Review & { book: BookBrief; commentCount: number };

// Getter, damit die Texte beim Sprachwechsel neu ausgewertet werden
export const visibilityLabel = {
  get private() { return t('vis.private'); },
  get instance() { return t('vis.instance'); },
  get federated() { return t('vis.federated'); }
} satisfies Record<Visibility, string>;

/** 3.5 → "3,5" */
export const fmtRating = (r: number) => r.toLocaleString(i18n.locale, { maximumFractionDigits: 2 });

/** SQLite-Zeitstempel (UTC ohne Zone) → relative deutsche Angabe */
export function ago(ts: string): string {
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return t('ago.now');
  if (s < 3600) return t('ago.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('ago.h', { n: Math.floor(s / 3600) });
  if (s < 7 * 86400) { const n = Math.floor(s / 86400); return n === 1 ? t('ago.yesterday') : t('ago.days', { n }); }
  return d.toLocaleDateString(i18n.locale);
}

export type Profile = {
  id: number; username: string; displayName: string; createdAt: string; shelfVisible: boolean; avatarUrl: string | null;
  counts: { books: number; read: number; readThisYear: number; reviews: number };
  averageRating: number | null;
  favorites: BookBrief[]; reading: BookBrief[]; wishlistCount: number;
};

export type CopyLoan = { id: number | null; borrowerId: number | null; borrowerName: string | null; lentAt: string; dueAt: string | null; note: string | null };

export type Copy = {
  id: number; format: Format; binding: Binding | null; sprayedEdges: boolean; readStatus: ReadStatus;
  notes: string | null; createdAt: string; ownerId: number; ownerName: string; mine: boolean;
  store: string | null; storeId: number | null;
  loan: CopyLoan | null;
};

export type Loan = {
  id: number; copyId: number | null; remoteLoanId?: number; lentAt: string; dueAt: string | null; returnedAt: string | null; overdue: boolean; note: string | null;
  lender: { id: number | null; displayName: string }; borrower: { id: number | null; displayName: string } | null; mine: boolean;
  copy: { format: Format; binding: Binding | null }; book: Omit<BookBrief, 'id'> & { id: number | null };
};
export type Loans = { lent: Loan[]; borrowed: Loan[]; history: Loan[] };

export type NotificationItem = {
  id: number; type: 'loan_new' | 'loan_returned' | 'comment' | 'invite_accepted'; refId: number | null; createdAt: string; read: boolean;
  actor: { id: number | null; displayName: string; avatarUrl: string | null } | null; book: BookBrief | null;
};
export type FeedItem = {
  type: 'started' | 'finished' | 'reviewed'; ts: string; rating: number | null; reviewId: number | null; text: string | null; spoiler: boolean;
  user: { id: number; displayName: string; avatarUrl: string | null }; book: BookBrief;
};

export type HistoryType = 'added' | 'removed' | 'started' | 'finished' | 'dnf' | 'reviewed' | 'lent' | 'got_back' | 'borrowed' | 'gave_back';
export const HISTORY_TYPES: HistoryType[] = ['added', 'started', 'finished', 'dnf', 'reviewed', 'lent', 'got_back', 'borrowed', 'gave_back', 'removed'];
export const LOAN_TYPES: HistoryType[] = ['lent', 'got_back', 'borrowed', 'gave_back'];
export type HistoryEvent = { type: HistoryType; date: string; person: string | null; rating: number | null; dueAt: string | null; reason?: RemoveReason | null; book: BookBrief };

export type SearchHit = {
  isbn13: string; title: string; subtitle: string | null; authors: string[]; publisher: string | null;
  year: number | null; bookId: number | null; coverUrl: string | null;
};

export type Invite = { id: number; token: string; note: string | null; createdAt: string; expiresAt: string; usedAt: string | null; usedBy: string | null; createdBy?: string };

// Getter: Texte folgen der aktuellen Sprache
export const labels = {
  get format(): Record<Format, string> { return { print: t('format.print'), ebook: t('format.ebook') }; },
  get binding(): Record<Binding, string> { return { paperback: t('binding.paperback'), hardcover: t('binding.hardcover') }; },
  get read(): Record<ReadStatus, string> { return { unread: t('read.unread'), reading: t('read.reading'), read: t('read.read'), dnf: t('read.dnf') }; }
};

/** Fortschritt in Prozent; ohne bekannte Seitenzahl wird der Fortschritt selbst als Prozentwert gespeichert */
export const percent = (progress: number | null, pages: number | null) =>
  progress ? Math.min(100, Math.round((progress / (pages || 100)) * 100)) : 0;

export const inviteUrl = (token: string) => `${location.origin}/invite/${token}`;

export type Stats = {
  years: string[]; year: string | null; user: { displayName: string; username: string };
  totals: { books: number; pages: number; avgRating: number | null; avgDays: number | null; rated: number; dnf: number };
  perMonth: { month: number; books: number; pages: number }[]; perYear: { name: string; n: number }[];
  ratings: { rating: number; n: number }[]; genres: { name: string; n: number }[]; authors: { name: string; n: number }[];
  formats: { name: 'print' | 'ebook' | 'none'; n: number }[]; languages: { name: string; n: number }[];
  highlights: { first: BookBrief | null; last: BookBrief | null; longest: BookBrief | null; shortest: BookBrief | null; fiveStars: BookBrief[] };
};
