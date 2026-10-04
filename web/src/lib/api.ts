import { t, i18n } from './i18n.svelte.ts';
import { net, isNetworkError, QUEUEABLE, QueuedError, queueWrite, cacheGet, cachedGet } from './offline.svelte.ts';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

/**
 * Offline: GETs fallen auf die zuletzt geladene Antwort zurück, Lesestand/Bewertung werden vorgemerkt (QueuedError).
 * Alles andere wirft wie gehabt den Netzfehler.
 */
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  try {
    const data = await send<T>(method, url, body);
    if (method === 'GET' && !url.startsWith('/notifications') && !url.startsWith('/status')) cacheGet(`/api${url}`, data);
    return data;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    net.online = false;
    if (method === 'GET') {
      const hit = await cachedGet<T>(`/api${url}`);
      if (hit !== undefined) return hit;
    }
    if (method === 'PUT' && QUEUEABLE.test(url)) {
      queueWrite(url, (body ?? {}) as Record<string, unknown>);
      throw new QueuedError(t('offline.queued'));
    }
    throw e;
  }
}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
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
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
  /** ohne Offline-Logik (Abgleich der Warteschlange) */
  sendPut: (url: string, body: unknown) => send('PUT', url, body)
};

// ---------- Typen ----------

export type Me = { id: number; username: string; displayName: string; isAdmin: boolean; shelfVisible: boolean; createdAt: string; avatarUrl: string | null; prefs: import('./theme.ts').Prefs };

export type Book = {
  id: number; isbn13: string | null; title: string; subtitle: string | null; authors: string[];
  publisher: string | null; year: number | null; pages: number | null; language: string | null; subjects: string[]; coverUrl: string | null;
  series?: string | null; seriesIndex?: number | null;
};

export type SeriesBook = BookBrief & { index: number | null; status: ReadStatus; owned: boolean; friends: number };
export type Series = { name: string; books: SeriesBook[]; next: SeriesBook | null };
export type MySeries = { name: string; total: number; read: number; owned: number; next: SeriesBook | null; covers: { id: number; title: string; coverUrl: string | null; status: ReadStatus }[] };
export const seriesHref = (name: string) => `/series?name=${encodeURIComponent(name)}`;

export type Format = 'print' | 'ebook';
export type Binding = 'paperback' | 'hardcover';
export type ReadStatus = 'unread' | 'reading' | 'read' | 'dnf';

export type CopyValues = { format: Format; binding: Binding | null; sprayedEdges: boolean; readStatus: ReadStatus; notes: string; storeId: number | null; finishedAt?: string };
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
export const MOODS = ['adventurous', 'challenging', 'dark', 'emotional', 'funny', 'hopeful', 'informative', 'inspiring',
  'lighthearted', 'mysterious', 'reflective', 'relaxing', 'romantic', 'sad', 'tense'] as const;
export type Mood = (typeof MOODS)[number];
export const PACES = ['slow', 'medium', 'fast'] as const;
export type Pace = (typeof PACES)[number];

export type Review = {
  id: number; bookId: number; rating: number | null; text: string | null; visibility: Visibility; spoiler: boolean;
  moods: Mood[]; pace: Pace | null;
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
  top: BookBrief[]; favorites: BookBrief[]; reading: BookBrief[]; wishlistCount: number;
};

export type CopyLoan = { id: number | null; borrowerId: number | null; borrowerName: string | null; lentAt: string; dueAt: string | null; note: string | null };

export type Copy = {
  id: number; format: Format; binding: Binding | null; sprayedEdges: boolean; readStatus: ReadStatus;
  notes: string | null; createdAt: string; ownerId: number; ownerName: string; mine: boolean;
  store: string | null; storeId: number | null;
  loan: CopyLoan | null;
  /** meine offene Leihanfrage an dieses Exemplar */
  requestId?: number | null;
};

export type Loan = {
  id: number; copyId: number | null; remoteLoanId?: number; lentAt: string; dueAt: string | null; returnedAt: string | null; overdue: boolean; note: string | null;
  lender: { id: number | null; displayName: string }; borrower: { id: number | null; displayName: string } | null; mine: boolean;
  copy: { format: Format; binding: Binding | null }; book: Omit<BookBrief, 'id'> & { id: number | null };
};
export type LoanRequest = {
  id: number; copyId: number; message: string | null; status: 'pending' | 'accepted' | 'declined' | 'cancelled'; createdAt: string; decidedAt: string | null;
  loanId: number | null; lentOut: boolean; owner: { id: number; displayName: string }; requester: { id: number; displayName: string };
  copy: { format: Format; binding: Binding | null }; book: BookBrief;
};
export type Loans = { lent: Loan[]; borrowed: Loan[]; history: Loan[]; requests: { incoming: LoanRequest[]; outgoing: LoanRequest[] } };

export type NotificationItem = {
  id: number; type: 'loan_new' | 'loan_returned' | 'comment' | 'invite_accepted' | 'loan_due' | 'loan_overdue' | 'wish_available' | 'import_done' | 'list_shared' | 'loan_request' | 'loan_declined' | 'buddy_invite' | 'buddy_post'; refId: number | null; createdAt: string; read: boolean;
  actor: { id: number | null; displayName: string; avatarUrl: string | null } | null; book: BookBrief | null; list: { id: number; name: string } | null;
};
export type FeedItem = {
  type: 'added' | 'started' | 'finished' | 'dnf' | 'reviewed' | 'listed'; ts: string; rating: number | null; reviewId: number | null; text: string | null; spoiler: boolean;
  list: { id: number; name: string } | null; format: Format | null;
  user: { id: number; displayName: string; avatarUrl: string | null }; book: BookBrief;
};

export type HistoryType = 'added' | 'removed' | 'started' | 'finished' | 'dnf' | 'reviewed' | 'lent' | 'got_back' | 'borrowed' | 'gave_back';
export const HISTORY_TYPES: HistoryType[] = ['added', 'started', 'finished', 'dnf', 'reviewed', 'lent', 'got_back', 'borrowed', 'gave_back', 'removed'];
export const LOAN_TYPES: HistoryType[] = ['lent', 'got_back', 'borrowed', 'gave_back'];
export type HistoryEvent = { type: HistoryType; date: string; person: string | null; rating: number | null; dueAt: string | null; reason?: RemoveReason | null; book: BookBrief };

export type SearchHit = {
  isbn13: string; title: string; subtitle: string | null; authors: string[]; publisher: string | null;
  year: number | null; bookId: number | null; coverUrl: string | null;
  /** wer im Freundeskreis das Buch hat */
  owners?: { id: number; displayName: string }[];
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

export type StatGroup<N extends string = string> = { name: N; n: number; ids: number[] };
export type Stats = {
  years: string[]; year: string | null; user: { displayName: string; username: string };
  totals: { books: number; pages: number; avgPages: number | null; avgRating: number | null; avgDays: number | null; rated: number; withMood: number; dnf: number };
  perMonth: { month: number; books: number; pages: number; ids: number[]; mood: number | null }[]; perYear: StatGroup[];
  ratings: { rating: number; n: number; ids: number[] }[]; genres: StatGroup[]; authors: StatGroup[];
  formats: StatGroup<'print' | 'ebook' | 'none'>[]; languages: StatGroup[]; pageBuckets: StatGroup[];
  moods: StatGroup<Mood>[]; paces: StatGroup<Pace>[]; books: Record<number, BookBrief>;
  highlights: { first: BookBrief | null; last: BookBrief | null; longest: BookBrief | null; shortest: BookBrief | null; fiveStars: BookBrief[] };
};

export type ListVisibility = 'private' | 'instance';
export type ReadingListSummary = { id: number; name: string; description: string | null; visibility: ListVisibility; updatedAt: string; count: number; preview: BookBrief[];
  shared: boolean; owner: { id: number; displayName: string } | null };
export type ListMember = { id: number; displayName: string; username: string; avatarUrl: string | null };

export type BuddyMember = { id: number; displayName: string; avatarUrl: string | null; owner: boolean; position: number };
export type BuddyRead = {
  id: number; note: string | null; endsAt: string | null; createdAt: string; mine: boolean; book: BookBrief;
  members: BuddyMember[]; myPosition: number; posts?: number; unseen?: number;
};
export type BuddyPost = {
  id: number; position: number; page: number | null; createdAt: string; locked: boolean; text: string | null; mine: boolean;
  user: { id: number; displayName: string; avatarUrl: string | null };
};
export type ReadingList = {
  id: number; name: string; description: string | null; visibility: ListVisibility; createdAt: string; updatedAt: string; mine: boolean;
  canEdit: boolean; owner: { id: number; displayName: string; username: string; avatarUrl: string | null }; members: ListMember[];
  items: { note: string | null; addedAt: string; myStatus: ReadStatus; book: BookBrief; addedBy: { id: number; displayName: string } | null }[];
};
