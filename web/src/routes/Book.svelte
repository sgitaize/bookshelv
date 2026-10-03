<script lang="ts">
  import { api, labels, emptyCopy, percent, type Book, type Copy, type CopyValues, type Reading, type ReadStatus } from '../lib/api.ts';
  import ProgressSheet from '../components/ProgressSheet.svelte';
  import Reviews from '../components/Reviews.svelte';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, tn, i18n, fmtDate as fmtD } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import CopyForm from '../components/CopyForm.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Icon from '../components/Icon.svelte';

  let { id }: { id: number } = $props();

  let data = $state<{ book: Book; copies: Copy[]; canEdit: boolean; reading: Reading } | null>(null);
  let progressOpen = $state(false);
  let askReview = $state(false);
  let editing = $state<{ copyId: number | null; values: CopyValues } | null>(null);
  let editBook = $state<{ title: string; subtitle: string; authors: string; publisher: string; year: string; pages: string } | null>(null);
  let busy = $state(false);

  const load = () => api.get<typeof data>(`/books/${id}`).then(r => (data = r)).catch(toastError);
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
      // gerade fertig gelesen → direkt zum Bewerten einladen
      if (patch.status === 'read' && before !== 'read') askReview = true;
    } catch (e) { toastError(e); }
  }

  const fmtDate = (d: string | null) => fmtD(d);

  function describe(c: Copy) {
    return [labels.format[c.format], c.binding && labels.binding[c.binding]].filter(Boolean).join(' · ');
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

  async function removeCopy(c: Copy) {
    if (!confirm(t('book.removeCopyQ'))) return;
    try {
      await api.del(`/copies/${c.id}`);
      toast(t('common.removed'));
      editing = null;
      await load();
      if (!mine.length && !others.length) router.go('/', true);
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
      {#if data.canEdit}<button class="ghost small" onclick={openBookEdit}><Icon name="edit" size={16} /> {t('book.edit')}</button>{/if}
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
    {#if r.startedAt || r.finishedAt}
      <p class="muted small dates">
        {#if r.startedAt}{t('book.started', { d: fmtDate(r.startedAt) })}{/if}{#if r.startedAt && r.finishedAt} · {/if}{#if r.finishedAt}{r.status === 'dnf' ? t('book.dnfOn', { d: fmtDate(r.finishedAt) }) : t('book.finishedOn', { d: fmtDate(r.finishedAt) })}{/if}
      </p>
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
        </div>
        <button class="icon ghost" aria-label={t('common.edit')}
          onclick={() => (editing = { copyId: c.id, values: { format: c.format, binding: c.binding, sprayedEdges: c.sprayedEdges, readStatus: c.readStatus, notes: c.notes ?? '' } })}>
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
            <div class="muted small">{describe(c)} · {labels.read[c.readStatus]}</div>
          </div>
          {#if c.sprayedEdges}<span class="chip edge">{t('copy.edges')}</span>{/if}
        </a>
      {/each}
    {/if}
  </section>
{/if}

{#if data}
  <ProgressSheet item={progressOpen ? { book: data.book, progress: data.reading.progress, status: data.reading.status } : null}
    onclose={() => (progressOpen = false)} onsaved={load} />
{/if}

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
  .dates { margin: 0; }
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
  .avatar {
    width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0;
    background: var(--surface-3); font-weight: 700; color: var(--accent);
  }
  .actions { margin-top: 1.2rem; }
  .actions .primary { flex: 1; }
</style>
