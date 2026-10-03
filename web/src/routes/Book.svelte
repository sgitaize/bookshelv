<script lang="ts">
  import { api, labels, emptyCopy, percent, type Book, type Copy, type CopyValues, type Reading, type ReadStatus } from '../lib/api.ts';
  import ProgressSheet from '../components/ProgressSheet.svelte';
  import Reviews from '../components/Reviews.svelte';
  import LendSheet from '../components/LendSheet.svelte';
  import Timeline from '../components/Timeline.svelte';
  import RemoveSheet from '../components/RemoveSheet.svelte';
  import type { HistoryEvent, ArchivedCopy } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, tn, i18n, fmtDate as fmtD, type Key } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import CopyForm from '../components/CopyForm.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Icon from '../components/Icon.svelte';
  import ListSheet from '../components/ListSheet.svelte';
  import DatesSheet from '../components/DatesSheet.svelte';
  import FeedList from '../components/FeedList.svelte';
  import type { FeedItem } from '../lib/api.ts';

  let { id }: { id: number } = $props();

  let listOpen = $state(false);
  let datesOpen = $state(false);
  let datesJust = $state(false);
  let bookFeed = $state<FeedItem[]>([]);
  $effect(() => { api.get<{ items: FeedItem[] }>(`/feed?book=${id}&limit=20`).then(r => (bookFeed = r.items)).catch(() => {}); });
  let data = $state<{ book: Book; copies: Copy[]; canEdit: boolean; wishlisted: boolean; reading: Reading; archived: ArchivedCopy[] } | null>(null);
  let removing = $state<{ id: number; archived: boolean } | null>(null);
  let progressOpen = $state(false);
  let askReview = $state(false);
  let lendCopy = $state<number | null>(null);

  async function gotBack(loanId: number) {
    try {
      await api.post(`/loans/${loanId}/return`, {});
      toast(t('loan.returned'));
      await load();
    } catch (e) { toastError(e); }
  }
  let editing = $state<{ copyId: number | null; values: CopyValues } | null>(null);
  let editBook = $state<{ title: string; subtitle: string; authors: string; publisher: string; year: string; pages: string } | null>(null);
  let busy = $state(false);

  let history = $state<HistoryEvent[]>([]);
  const load = () => Promise.all([
    api.get<typeof data>(`/books/${id}`).then(r => (data = r)),
    api.get<{ events: HistoryEvent[] }>(`/history?book=${id}`).then(r => (history = r.events))
  ]).catch(toastError);
  $effect(() => { load(); });

  // Schlagworte entdoppeln ("Fiction" vs. "Fiction, science fiction, general") und auf wenige kürzen
  const subjects = $derived.by(() => {
    const out: string[] = [];
    for (const s of data?.book.subjects ?? []) {
      const l = s.toLowerCase();
      if (!out.some(o => l.includes(o.toLowerCase()) || o.toLowerCase().includes(l))) out.push(s);
    }
    return out.slice(0, 4);
  });

  const mine = $derived(data?.copies.filter(c => c.mine) ?? []);
  const others = $derived(data?.copies.filter(c => !c.mine) ?? []);

  async function setReading(patch: Partial<Reading>) {
    try {
      const before = data!.reading.status;
      data!.reading = await api.put<Reading>(`/books/${id}/reading`, patch);
      // gerade fertig gelesen/abgebrochen → erst fragen, wann (vorbelegt mit heute), danach zum Bewerten einladen
      if ((patch.status === 'read' || patch.status === 'dnf') && before !== patch.status) { datesJust = true; datesOpen = true; }
    } catch (e) { toastError(e); }
  }

  const fmtDate = (d: string | null) => fmtD(d);

  function describe(c: Copy) {
    return [labels.format[c.format], c.binding && labels.binding[c.binding], c.store].filter(Boolean).join(' · ');
  }

  async function saveCopy() {
    if (!editing) return;
    busy = true;
    try {
      if (editing.copyId) await api.patch(`/copies/${editing.copyId}`, editing.values);
      else await api.post('/copies', { bookId: id, ...editing.values });
      editing = null;
      toast(t('common.saved'));
      await load();
    } catch (e) { toastError(e); } finally { busy = false; }
  }

  async function toggleWish() {
    try {
      if (data!.wishlisted) await api.del(`/books/${id}/wishlist`);
      else { await api.put(`/books/${id}/wishlist`, {}); toast(t('wish.added')); }
      data!.wishlisted = !data!.wishlisted;
    } catch (e) { toastError(e); }
  }

  /** Eigenes Cover: im Browser auf max. 900 px Höhe verkleinern, dann hochladen */
  async function pickCover(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    try {
      const img = await createImageBitmap(file);
      const scale = Math.min(1, 900 / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      let image = canvas.toDataURL('image/webp', 0.85);
      if (!image.startsWith('data:image/webp')) image = canvas.toDataURL('image/jpeg', 0.85);
      data!.book = await api.post<Book>(`/books/${id}/cover`, { image });
      toast(t('cover.saved'));
    } catch (err) { toastError(err); }
  }

  function removeCopy(c: { id: number }, archived = false) {
    editing = null;
    removing = { id: c.id, archived };
  }

  async function restore(id: number) {
    try {
      await api.post(`/copies/${id}/restore`);
      toast(t('rm.restored'));
      await load();
    } catch (e) { toastError(e); }
  }

  function openBookEdit() {
    const b = data!.book;
    editBook = { title: b.title, subtitle: b.subtitle ?? '', authors: b.authors.join(', '), publisher: b.publisher ?? '',
      year: b.year?.toString() ?? '', pages: b.pages?.toString() ?? '' };
  }

  async function saveBook(e: SubmitEvent) {
    e.preventDefault();
    if (!editBook) return;
    busy = true;
    try {
      await api.patch(`/books/${id}`, {
        ...editBook,
        authors: editBook.authors.split(/[,;]/).map(a => a.trim()).filter(Boolean),
        year: editBook.year || null, pages: editBook.pages || null
      });
      editBook = null;
      await load();
    } catch (err) { toastError(err); } finally { busy = false; }
  }
</script>

{#if !data}
  <div class="spinner"></div>
{:else}
  {@const b = data.book}
  <button class="ghost back" onclick={() => router.back()}><Icon name="back" size={18} /> {t('common.back')}</button>
  <article class="detail">
    <div class="cover-wrap">
      <div class="glow" style={b.coverUrl ? `background-image: url(${b.coverUrl})` : ''}></div>
      <Cover url={b.coverUrl} title={b.title} authors={b.authors} size="lg" />
    </div>
    <div class="meta">
      <h1>{b.title}</h1>
      {#if b.subtitle}<p class="subtitle">{b.subtitle}</p>{/if}
      <p class="authors">{b.authors.join(', ') || t('book.unknownAuthor')}</p>
      <dl>
        {#if b.publisher}<dt>{t('book.publisher')}</dt><dd>{b.publisher}</dd>{/if}
        {#if b.year}<dt>{t('book.year')}</dt><dd>{b.year}</dd>{/if}
        {#if b.pages}<dt>{t('book.pages')}</dt><dd>{b.pages}</dd>{/if}
        {#if b.isbn13}<dt>ISBN</dt><dd>{b.isbn13}</dd>{/if}
      </dl>
      {#if subjects.length}
        <div class="row subjects">{#each subjects as s}<span class="chip">{s}</span>{/each}</div>
      {/if}
      <div class="row bookacts">
        {#if !mine.length || data.wishlisted}
          <button class="small" class:on={data.wishlisted} onclick={toggleWish}><Icon name="bookmark" size={16} /> {data.wishlisted ? t('wish.on') : t('wish.add')}</button>
        {/if}
        <button class="small" onclick={() => (listOpen = true)}><Icon name="list" size={16} /> {t('list.addTo')}</button>
        {#if data.canEdit || (!b.coverUrl && mine.length)}
          <label class="btn small ghost"><Icon name="image" size={16} /> {t('cover.upload')}<input type="file" accept="image/*" onchange={pickCover} hidden /></label>
        {/if}
        {#if data.canEdit}<button class="ghost small" onclick={openBookEdit}><Icon name="edit" size={16} /> {t('book.edit')}</button>{/if}
      </div>
    </div>
  </article>

  {@const r = data.reading}
  <section class="card reading">
    <div class="spread">
      <div class="segmented">
        {#each ['unread', 'reading', 'read', 'dnf'] as const as st}
          <button class:active={r.status === st} onclick={() => setReading({ status: st as ReadStatus })}>{labels.read[st]}</button>
        {/each}
      </div>
      <button class="icon ghost fav" class:on={r.favorite} onclick={() => setReading({ favorite: !r.favorite })}
        aria-label={r.favorite ? t('book.unfav') : t('book.fav')} aria-pressed={r.favorite}>
        <Icon name="heart" size={22} />
      </button>
    </div>
    {#if r.status === 'reading'}
      {@const pct = percent(r.progress, b.pages)}
      <button class="bar" onclick={() => (progressOpen = true)}>
        <span class="fill" style="width: {Math.max(pct, 3)}%"></span>
        <span class="pct">{pct}%{#if r.progress && b.pages} · {t('book.pageOf', { p: r.progress, n: b.pages })}{/if} – {t('book.tapUpdate')}</span>
      </button>
    {/if}
    {#if r.status !== 'unread'}
      <button class="ghost small dates" onclick={() => { datesJust = false; datesOpen = true; }}>
        <span>
          {#if r.startedAt}{t('book.started', { d: fmtDate(r.startedAt) })}{/if}{#if r.startedAt && (r.finishedAt || r.status === 'read' || r.status === 'dnf')} · {/if}{#if r.finishedAt}{r.status === 'dnf' ? t('book.dnfOn', { d: fmtDate(r.finishedAt) }) : t('book.finishedOn', { d: fmtDate(r.finishedAt) })}{:else if r.status === 'read' || r.status === 'dnf'}{t('dates.noDate')}{/if}{#if !r.startedAt && r.status === 'reading'}{t('dates.noStart')}{/if}
        </span>
        <Icon name="edit" size={14} />
      </button>
    {/if}
  </section>

  <Reviews bookId={id} title={b.title} bind:askReview />

  <section class="stack copies">
    <div class="spread">
      <h2>{t('book.myCopies')}</h2>
      <button onclick={() => (editing = { copyId: null, values: emptyCopy() })}><Icon name="plus" size={16} /> {mine.length ? t('book.another') : t('add.toShelf')}</button>
    </div>
    {#if !mine.length}<p class="muted">{t('book.notOwned')}</p>{/if}
    {#each mine as c (c.id)}
      <div class="card copy">
        <span class="fmt"><Icon name={c.format === 'ebook' ? 'tablet' : 'book'} /></span>
        <div class="grow">
          <strong>{describe(c)}</strong>
          {#if c.sprayedEdges}<div class="row tags"><span class="chip edge">{t('copy.edges')}</span></div>{/if}
          {#if c.notes}<p class="muted small note">{c.notes}</p>{/if}
          {#if c.loan}
            <p class="loaninfo small">
              <Icon name="users" size={14} /> {t('loan.lentTo', { name: c.loan.borrowerName ?? '–' })} · {t('loan.since', { d: fmtDate(c.loan.lentAt) })}{#if c.loan.dueAt} · {t('loan.dueOn', { d: fmtDate(c.loan.dueAt) })}{/if}
            </p>
            <div class="row loanacts">
              <button class="small primary" onclick={() => gotBack(c.loan!.id!)}><Icon name="check" size={14} /> {t('loan.back')}</button>
              <a class="small" href="/loans">{t('loan.all')}</a>
            </div>
          {:else}
            <div class="row loanacts">
              <button class="small lendbtn" onclick={() => (lendCopy = c.id)}><Icon name="users" size={14} /> {t('loan.lend')}</button>
              <button class="small ghost danger" onclick={() => removeCopy(c)}><Icon name="trash" size={14} /> {t('copy.removeFromShelf')}</button>
            </div>
          {/if}
        </div>
        <button class="icon ghost" aria-label={t('common.edit')}
          onclick={() => (editing = { copyId: c.id, values: { format: c.format, binding: c.binding, sprayedEdges: c.sprayedEdges, readStatus: c.readStatus, notes: c.notes ?? '', storeId: c.storeId } })}>
          <Icon name="edit" size={18} />
        </button>
      </div>
    {/each}

    {#if others.length}
      <h2>{t('book.amongFriends')}</h2>
      {#each others as c (c.id)}
        <a class="card copy" href="/people/{c.ownerId}">
          <span class="avatar">{c.ownerName.slice(0, 1).toUpperCase()}</span>
          <div class="grow">
            <strong>{c.ownerName}</strong>
            <div class="muted small">{describe(c)} · {labels.read[c.readStatus]}{#if c.loan} · {c.loan.borrowerName ? t('loan.at', { name: c.loan.borrowerName }) : t('loan.lentOut')}{/if}</div>
          </div>
          {#if c.sprayedEdges}<span class="chip edge">{t('copy.edges')}</span>{/if}
        </a>
      {/each}
    {/if}
  </section>

  {#if data.archived.length}
    <section class="stack archived">
      <h2>{t('rm.archivedTitle')}</h2>
      {#each data.archived as a (a.id)}
        <div class="card copy">
          <span class="fmt"><Icon name="trash" /></span>
          <div class="grow">
            <strong>{describe({ format: a.format, binding: a.binding, store: null } as Copy)}</strong>
            <p class="muted small note">{t('rm.archivedOn', { reason: t(`rm.${a.removedReason ?? 'other'}` as Key), d: fmtDate(a.removedAt) })}</p>
            <div class="row loanacts">
              <button class="small" onclick={() => restore(a.id)}>{t('rm.restore')}</button>
              <button class="small ghost danger" onclick={() => removeCopy(a, true)}>{t('rm.purge')}</button>
            </div>
          </div>
        </div>
      {/each}
    </section>
  {/if}

  {#if bookFeed.length}
    <section class="hist">
      <h2>{t('feed.bookHistory')}</h2>
      <FeedList items={bookFeed} compact />
    </section>
  {/if}

  {#if history.length}
    <section class="hist">
      <h2>{t('hist.book')}</h2>
      <Timeline events={history} compact />
    </section>
  {/if}
{/if}

{#if data}
  {#if data}
  <DatesSheet bookId={id} reading={data.reading} open={datesOpen} just={datesJust}
    onclose={() => { datesOpen = false; if (datesJust && data?.reading.status === 'read') askReview = true; datesJust = false; }}
    onsaved={r => { data!.reading = r; datesOpen = false; if (datesJust && r.status === 'read') askReview = true; datesJust = false; }} />
{/if}
<ListSheet bookId={id} open={listOpen} onclose={() => (listOpen = false)} />
<ProgressSheet item={progressOpen ? { book: data.book, progress: data.reading.progress, status: data.reading.status } : null}
    onclose={() => (progressOpen = false)} onsaved={load} />
{/if}

<RemoveSheet copyId={removing?.id ?? null} archivedOnly={removing?.archived ?? false} title={data?.book.title ?? ''}
  onclose={() => (removing = null)} onsaved={load} />

<LendSheet copyId={lendCopy} title={data?.book.title ?? ''} onclose={() => (lendCopy = null)} onsaved={load} />

<Sheet open={!!editing} onclose={() => (editing = null)} title={editing?.copyId ? t('book.editCopy') : t('book.addCopy')}>
  {#if editing}
    <CopyForm bind:value={editing.values} showStatus={false} />
    <div class="row actions">
      <button class="primary" onclick={saveCopy} disabled={busy}>{t('common.save')}</button>
      {#if editing.copyId}
        {@const c = mine.find(m => m.id === editing!.copyId)}
        {#if c}<button class="danger ghost" onclick={() => removeCopy(c)}><Icon name="trash" size={16} /> {t('common.remove')}</button>{/if}
      {/if}
    </div>
  {/if}
</Sheet>

<Sheet open={!!editBook} onclose={() => (editBook = null)} title={t('book.edit')}>
  {#if editBook}
    <form class="stack" onsubmit={saveBook}>
      <label class="field"><span>{t('book.title')}</span><input bind:value={editBook.title} required /></label>
      <label class="field"><span>{t('book.subtitle')}</span><input bind:value={editBook.subtitle} /></label>
      <label class="field"><span>{t('book.authors')}</span><input bind:value={editBook.authors} /></label>
      <label class="field"><span>{t('book.publisher')}</span><input bind:value={editBook.publisher} /></label>
      <div class="row">
        <label class="field grow"><span>{t('book.year')}</span><input bind:value={editBook.year} inputmode="numeric" /></label>
        <label class="field grow"><span>{t('book.pages')}</span><input bind:value={editBook.pages} inputmode="numeric" /></label>
      </div>
      <p class="muted small">{t('book.shared')}</p>
      <button class="primary" disabled={busy}>{t('common.save')}</button>
    </form>
  {/if}
</Sheet>

<style>
  .back { margin: -0.6rem 0 0.4rem -0.8rem; border: none; background: none; color: var(--muted); padding: 0.4em 0.6em; }
  .detail { display: grid; gap: 1.6rem; justify-items: center; text-align: center; margin-bottom: 2rem; }
  .cover-wrap { position: relative; max-width: 100%; }
  .glow {
    position: absolute; inset: 10% -20%;
    background-size: cover; background-position: center;
    filter: blur(50px) saturate(1.4); opacity: 0.3; z-index: -1;
  }
  .subjects { gap: 0.3rem; margin-bottom: 0.8rem; justify-content: inherit; }
  .reading { display: grid; gap: 0.8rem; margin-bottom: 2rem; }
  .fav { color: var(--muted); }
  .fav.on { color: #e0475b; }
  .fav.on :global(path) { fill: currentColor; }
  .bar {
    position: relative; height: 30px; padding: 0; border: none; border-radius: 8px;
    background: var(--surface-3); overflow: hidden; display: block; width: 100%;
  }
  .fill { position: absolute; inset: 0 auto 0 0; background: var(--progress); }
  .pct { position: relative; font-size: 0.8rem; font-weight: 500; padding-left: 10px; line-height: 30px; display: block; text-align: left; }
  .dates { margin: 0; justify-self: start; justify-content: flex-start; gap: 0.4rem; color: var(--muted); padding: 0.3rem 0.5rem; white-space: normal; text-align: left; }
  .subtitle { font-size: 1.15rem; color: var(--muted); margin-top: -0.3rem; }
  .authors { font-weight: 600; color: var(--accent); }
  .subtitle { color: var(--muted); }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 1rem 0; text-align: left; font-size: 0.92rem; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  @media (min-width: 720px) {
    .detail { grid-template-columns: auto 1fr; text-align: left; justify-items: start; align-items: start; gap: 2.5rem; }
  }
  .copies { margin-top: 2rem; }
  .copies h2 { margin: 0.6rem 0 0; }
  .copy { display: flex; align-items: center; gap: 0.9rem; padding: 0.9rem 1rem; color: var(--text); }
  a.copy:hover { text-decoration: none; border-color: var(--surface-3); }
  .grow { flex: 1; min-width: 0; }
  .fmt { color: var(--accent); }
  .tags { margin-top: 0.3rem; gap: 0.3rem; }
  .note { margin: 0.4rem 0 0; white-space: pre-wrap; }
  .loaninfo { margin: 0.5rem 0 0; display: flex; align-items: center; gap: 0.35rem; color: var(--accent); font-weight: 500; flex-wrap: wrap; }
  .loanacts { margin-top: 0.4rem; gap: 0.6rem; }
  button.small { padding: 0.35em 0.75em; font-size: 0.82rem; }
  a.small { font-size: 0.82rem; }
  .lendbtn { margin: 0; }
  .hist, .archived { margin-top: 2rem; }
  .bookacts { gap: 0.4rem; justify-content: inherit; }
  .bookacts .small { padding: 0.4em 0.8em; font-size: 0.85rem; }
  .bookacts .on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .bookacts label { cursor: pointer; }
  .hist h2 { margin-bottom: 1rem; }
  .avatar {
    width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0;
    background: var(--surface-3); font-weight: 700; color: var(--accent);
  }
  .actions { margin-top: 1.2rem; }
  .actions .primary { flex: 1; }
</style>
