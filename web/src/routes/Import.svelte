<script lang="ts">
  import { api } from '../lib/api.ts';
  import { session, toast, toastError } from '../lib/state.svelte.ts';
  import { t, fmtDate, type Key } from '../lib/i18n.svelte.ts';
  import { parseCsv, convert, convertMapped, guessMapping, bookyRows, bookyDefaultPlan, applyBookyPlans, FIELDS, type BookyPlan, type ImportItem, type ImportSource, type Mapping, type Field } from '../lib/importers.ts';
  import Icon from '../components/Icon.svelte';
  import BookyPlanner from '../components/BookyPlanner.svelte';

  type ConflictField = 'status' | 'finishedAt' | 'rating' | 'review';
  type Conflict = { field: ConflictField; mine: unknown; theirs: unknown };
  type Result = { title: string; bookId?: number; result: 'ok' | 'exists' | 'failed' | 'conflict'; done?: string[]; conflicts?: Conflict[] };
  type Open = { item: ImportItem; title: string; field: ConflictField; mine: unknown; theirs: unknown; pick: 'mine' | 'theirs'; index: number };

  let source = $state<ImportSource | null>(null);
  let rows = $state<string[][]>([]);
  let mapping = $state<Mapping | null>(null);
  let appName = $state('');
  let parsed = $state<ImportItem[]>([]);
  let filename = $state('');
  let importId = $state<number | null>(null);
  let undone = $state(false);
  // Booky kennt keinen Besitz: je Liste wird festgelegt, was im Regal/auf der Wunschliste/in Leselisten landet
  let plans = $state<Record<string, BookyPlan>>({});
  const rowsBooky = $derived(source === 'booky' ? bookyRows(parsed) : []);
  const items = $derived.by(() => {
    if (source === 'generic' && mapping) return convertMapped(rows, mapping);
    if (source !== 'booky') return parsed;
    return applyBookyPlans(parsed, plans);
  });

  let copies = $state<'owned' | 'all' | 'none'>('owned');
  let reviews = $state(true);
  let wishlist = $state(true);
  let lists = $state(true);
  let visibility = $state<'instance' | 'private'>(session.me?.prefs?.reviewVisibility === 'private' ? 'private' : 'instance');
  let conflict = $state<'ask' | 'mine' | 'theirs'>('ask');
  let running = $state(false);
  let done = $state(0);
  let results = $state<Result[]>([]);
  let finished = $state(false);
  let open = $state<Open[]>([]);
  let resolved = $state(false);

  const app = $derived(source === 'generic' ? appName.trim() || t('imp.src.generic') : t(`imp.src.${source ?? 'generic'}` as Key));

  const counts = $derived({
    read: items.filter(i => i.status === 'read').length,
    reading: items.filter(i => i.status === 'reading').length,
    want: items.filter(i => i.status === 'want').length,
    rated: items.filter(i => i.rating || i.review).length,
    owned: items.filter(i => i.owned).length,
    listed: items.filter(i => i.lists?.length).length,
    wish: items.filter(i => i.wishlist || i.status === 'want').length,
    fav: items.filter(i => i.favorite).length,
    dnf: items.filter(i => i.status === 'dnf').length,
    noDate: items.filter(i => i.status === 'read' && !i.finishedAt).length,
    noIsbn: items.filter(i => !i.isbn).length
  });

  async function pick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    rows = parseCsv(await file.text());
    const r = convert(rows);
    source = r.source;
    parsed = r.items;
    mapping = r.source === 'generic' && rows[0] ? guessMapping(rows[0]) : null;
    // „booky_export_2026.csv“ → „booky“
    appName = r.source === 'generic' ? (file.name.replace(/\.[^.]+$/, '').split(/[-_ .]/)[0] ?? '') : '';
    results = []; done = 0; finished = false; open = []; resolved = false; importId = null; undone = false;
    filename = file.name;
    copies = r.source === 'booky' ? 'owned' : r.source === 'generic' || !r.items.some(i => i.owned) ? 'all' : 'owned';
    plans = r.source === 'booky' ? Object.fromEntries(bookyRows(r.items).map(row => [row.id, bookyDefaultPlan(row)])) : {};
  }

  /**
   * Der Import läuft als Job auf dem Server: Datei einmal hochladen, danach nur noch den Fortschritt abfragen.
   * Die App darf geschlossen werden; beim nächsten Öffnen der Seite wird ein laufender Import wieder angezeigt.
   */
  type Job = {
    id: number; status: 'running' | 'done' | 'cancelled'; total: number; done: number; ok: number; exists: number; failed: string[];
    conflicts?: { item: ImportItem; title: string; field: ConflictField; mine: unknown; theirs: unknown }[]; undoneAt: string | null; filename: string | null;
  };
  let job = $state<Job | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startedAt = 0, startedDone = 0;
  const total = $derived(job?.total ?? items.length);
  const eta = $derived.by(() => {
    if (!running || !job || job.done - startedDone < 8 || !startedAt) return null;
    const min = Math.ceil((((Date.now() - startedAt) / (job.done - startedDone)) * (job.total - job.done)) / 60000);
    return min > 0 ? min : null;
  });

  function apply(j: Job) {
    job = j; importId = j.id; done = j.done; undone = !!j.undoneAt;
    running = j.status === 'running';
    if (!running) {
      finished = true;
      if (!resolved) open = (j.conflicts ?? []).map((c, i) => ({ ...c, index: i, pick: 'mine' as const }));
    }
  }
  async function poll() {
    if (!importId) return;
    try { apply(await api.get<Job>(`/imports/${importId}`)); } catch { /* offline – später erneut */ }
    if (running) timer = setTimeout(poll, 2000);
  }
  // laufenden Import beim Öffnen der Seite wieder aufnehmen
  $effect(() => {
    api.get<Job[]>('/imports').then(list => {
      const r = list.find(j => j.status === 'running');
      if (r && !importId) { importId = r.id; filename = r.filename ?? ''; startedAt = Date.now(); startedDone = r.done; poll(); }
    }).catch(() => {});
    return () => { if (timer) clearTimeout(timer); };
  });

  async function start() {
    running = true;
    results = []; done = 0; open = []; resolved = false;
    const options = { copies, reviews, wishlist, visibility, lists, conflict };
    try {
      importId = (await api.post<{ id: number }>('/imports/jobs', { source: app, filename, items: $state.snapshot(items), options })).id;
      startedAt = Date.now(); startedDone = 0;
      poll();
    } catch (e) { toastError(e); running = false; }
  }

  async function cancel() {
    if (!importId || !confirm(t('imp.cancelQ'))) return;
    try { apply(await api.post<Job>(`/imports/${importId}/cancel`)); } catch (e) { toastError(e); }
  }

  /** Entscheidungen anwenden: Einträge mit „Import übernehmen“ laufen auf dem Server noch einmal durch */
  async function applyDecisions() {
    if (!importId) return;
    resolved = true;
    try {
      apply(await api.post<Job>(`/imports/${importId}/resolve`, { theirs: open.filter(o => o.pick === 'theirs').map(o => o.index) }));
      if (running) poll();
    } catch (e) { resolved = false; toastError(e); }
  }

  async function undoImport() {
    if (!importId || !confirm(t('imp.undoQ'))) return;
    running = true;
    try { await api.post(`/imports/${importId}/undo`); undone = true; toast(t('imp.undone')); } catch (e) { toastError(e); } finally { running = false; }
  }

  const setAll = (p: 'mine' | 'theirs') => open.forEach(o => (o.pick = p));
  const show = (f: ConflictField, v: unknown) =>
    v === null || v === undefined || v === '' ? '–'
      : f === 'rating' ? `${String(v).replace('.', ',')} ★`
      : f === 'status' ? t(`read.${v}` as Key)
      : f === 'finishedAt' ? fmtDate(String(v))
      : String(v).length > 120 ? String(v).slice(0, 120) + '…' : String(v);

  const summary = $derived({ ok: job?.ok ?? 0, exists: job?.exists ?? 0, failed: (job?.failed ?? []).map(title => ({ title })) });
</script>


<section class="stack">
  <h1>{t('imp.title')}</h1>
  <p class="muted">{t('imp.intro')}</p>

  <a class="small hist" href="/imports">{t('imp.history')} →</a>
  <div class="card stack">
    <label class="btn primary pick">
      <Icon name="download" size={16} /> {t('imp.pick')}
      <input type="file" accept=".csv,.tsv,.txt,text/csv" onchange={pick} hidden disabled={running} />
    </label>
    <details class="small muted">
      <summary>{t('imp.howTo')}</summary>
      <p>{t('imp.howGoodreads')}</p>
      <p>{t('imp.howStorygraph')}</p>
      <p>{t('imp.howBooky')}</p>
      <p>{t('imp.howOther')}</p>
      <p>{t('imp.howGeneric')}</p>
    </details>
  </div>

  {#if source === 'generic' && mapping && rows[0]}
    <div class="card stack">
      <h2>{t('imp.mapTitle')}</h2>
      <p class="muted small">{t('imp.mapInfo')}</p>
      <label class="field"><span>{t('imp.appName')}</span><input bind:value={appName} maxlength="40" placeholder="Booky" /></label>
      <div class="map">
        {#each FIELDS as f (f)}
          <label class="field"><span>{t(`imp.f.${f}` as Key)}</span>
            <select bind:value={mapping[f as Field]} disabled={running}>
              <option value={-1}>{t('imp.fNone')}</option>
              {#each rows[0] as h, i}<option value={i}>{h || `#${i + 1}`}</option>{/each}
            </select>
          </label>
        {/each}
      </div>
    </div>
  {/if}

  {#if source && items.length}
    <div class="card stack">
      <h2>{t('imp.preview', { n: items.length, source: app })}</h2>
      <ul class="facts">
        <li>{t('imp.cRead', { n: counts.read })}</li>
        <li>{t('imp.cReading', { n: counts.reading })}</li>
        {#if source !== 'booky'}<li>{t('imp.cWant', { n: counts.want })}</li>{/if}
        {#if source !== 'booky'}<li>{t('imp.cRated', { n: counts.rated })}</li>{/if}
        {#if source !== 'booky' && (source !== 'generic' || mapping?.owned !== -1)}<li>{t('imp.cOwned', { n: counts.owned })}</li>{/if}
        {#if counts.dnf}<li>{t('imp.cDnf', { n: counts.dnf })}</li>{/if}
        {#if source === 'booky' && counts.wish}<li>{t('imp.cWish', { n: counts.wish })}</li>{/if}
        {#if counts.fav}<li>{t('imp.cFav', { n: counts.fav })}</li>{/if}
        {#if counts.listed}<li>{t('imp.cListed', { n: counts.listed })}</li>{/if}
        {#if counts.noDate}<li class="muted">{t('imp.cNoDate', { n: counts.noDate })}</li>{/if}
        {#if counts.noIsbn}<li class="muted">{t('imp.cNoIsbn', { n: counts.noIsbn })}</li>{/if}
      </ul>

      {#if source === 'booky'}
        <BookyPlanner rows={rowsBooky} items={parsed} bind:plans />
        <span class="muted small">{t('imp.shelfInfo', { n: counts.owned })}</span>
      {:else}
      <div class="opt">
        <span class="lbl">{t('imp.copies')}</span>
        <div class="segmented">
          {#if source !== 'generic' || mapping?.owned !== -1}<button class:active={copies === 'owned'} onclick={() => (copies = 'owned')}>{t('imp.copiesOwned')}</button>{/if}
          <button class:active={copies === 'all'} onclick={() => (copies = 'all')}>{t('imp.copiesAll')}</button>
          <button class:active={copies === 'none'} onclick={() => (copies = 'none')}>{t('imp.copiesNone')}</button>
        </div>
      </div>
      {/if}

      <div class="opt">
        <span class="lbl">{t('imp.conflict')}</span>
        <div class="segmented wrap">
          <button class:active={conflict === 'ask'} onclick={() => (conflict = 'ask')}>{t('imp.conflictAsk')}</button>
          <button class:active={conflict === 'mine'} onclick={() => (conflict = 'mine')}>{t('imp.conflictMine')}</button>
          <button class:active={conflict === 'theirs'} onclick={() => (conflict = 'theirs')}>{t('imp.conflictTheirs', { app })}</button>
        </div>
        <span class="muted small">{t('imp.conflictInfo')}</span>
      </div>

      {#if counts.want && source !== 'booky'}<label class="row check"><input type="checkbox" bind:checked={wishlist} /> {t('imp.wishlist')}</label>{/if}
      {#if counts.listed && source !== 'booky'}<label class="row check"><input type="checkbox" bind:checked={lists} /> {t('imp.lists')}</label>{/if}
      {#if counts.rated}
        <label class="row check"><input type="checkbox" bind:checked={reviews} /> {t('imp.reviews')}</label>
        {#if reviews}
          <div class="segmented">
            <button class:active={visibility === 'instance'} onclick={() => (visibility = 'instance')}>{t('vis.instance')}</button>
            <button class:active={visibility === 'private'} onclick={() => (visibility = 'private')}>{t('vis.private')}</button>
          </div>
        {/if}
      {/if}

      {#if !finished && !running}
        <p class="note small">{t('imp.serverInfo')}</p>
      {/if}
      {#if !finished && !running}
        <button class="primary" onclick={start}>{t('imp.start', { n: items.length })}</button>
      {/if}
    </div>
  {:else if source}
    <p class="empty">{t('imp.empty')}</p>
  {/if}

  {#if running && job}
    <div class="card stack">
      <h2>{t('imp.running')}</h2>
      <div class="bar"><span style="width: {(job.done / Math.max(1, total)) * 100}%"></span></div>
      <p class="small muted">{t('imp.progress', { n: job.done, total })}{#if eta} · {t('imp.eta', { n: eta })}{/if}</p>
      <p class="note small">{t('imp.canClose')}</p>
      <div class="row"><button class="ghost danger" onclick={cancel}>{t('imp.cancel')}</button></div>
    </div>
  {/if}

  {#if finished && open.length && !resolved}
    <div class="card stack">
      <h2>{t('imp.conflictsTitle', { n: open.length })}</h2>
      <p class="muted small">{t('imp.conflictsInfo', { app })}</p>
      <div class="row">
        <button class="small" onclick={() => setAll('mine')}>{t('imp.allMine')}</button>
        <button class="small" onclick={() => setAll('theirs')}>{t('imp.allTheirs', { app })}</button>
      </div>
      <div class="conflicts">
        {#each open as o, i (i)}
          <div class="cf">
            <p class="cft"><strong>{o.title}</strong> · <span class="muted">{t(`imp.cf.${o.field}` as Key)}</span></p>
            <div class="choices">
              <label class:on={o.pick === 'mine'}><input type="radio" bind:group={o.pick} value="mine" /> <span class="src">bookshelv</span> {show(o.field, o.mine)}</label>
              <label class:on={o.pick === 'theirs'}><input type="radio" bind:group={o.pick} value="theirs" /> <span class="src">{app}</span> {show(o.field, o.theirs)}</label>
            </div>
          </div>
        {/each}
      </div>
      <button class="primary" onclick={applyDecisions} disabled={running}>{t('imp.applyDecisions')}</button>
    </div>
  {/if}

  {#if finished && (!open.length || resolved)}
    <div class="card stack">
      <h2>{t('imp.done')}</h2>
      <p>{t('imp.summary', { ok: summary.ok, exists: summary.exists, failed: summary.failed.length })}</p>
      {#if resolved}<p class="muted small">{t('imp.resolved')}</p>{/if}
      {#if undone}<p class="muted small">{t('imp.undone')}</p>{/if}
      {#if summary.failed.length}
        <details><summary>{t('imp.failedList')}</summary>
          <ul>{#each summary.failed as f}<li>{f.title}</li>{/each}</ul>
        </details>
      {/if}
      <div class="row"><a class="btn primary" href="/library">{t('shelf.mine')}</a><a class="btn" href="/lists">{t('list.title')}</a><a class="btn" href="/wishlist">{t('wish.title')}</a></div>
      <div class="row">
        {#if importId && !undone}<button class="ghost danger" onclick={undoImport} disabled={running}>{t('imp.undo')}</button>{/if}
        <a class="btn ghost" href="/imports">{t('imp.history')}</a>
      </div>
    </div>
  {/if}
</section>

<style>
  section { max-width: 720px; margin: 0 auto; }
  .hist { justify-self: start; }
  .pick { justify-self: start; cursor: pointer; }
  details p { margin: 0.4rem 0; }
  .facts { margin: 0; padding-left: 1.2rem; display: grid; gap: 0.15rem; }
  .opt { display: grid; gap: 0.35rem; justify-items: start; }
  .lbl { font-size: 0.85rem; color: var(--muted); }
  .check { font-weight: 500; cursor: pointer; }
  .segmented { align-self: start; max-width: 100%; }
  .segmented.wrap { flex-wrap: wrap; }
  .map { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr)); }
  .map select { width: 100%; }
  .bar { height: 10px; border-radius: 6px; background: var(--surface-3); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--progress); transition: width 0.3s; }
  .conflicts { display: grid; gap: 0.7rem; }
  .cf { border-top: 1px solid var(--line); padding-top: 0.6rem; }
  .cft { margin: 0 0 0.35rem; overflow-wrap: anywhere; }
  .choices { display: grid; gap: 0.35rem; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); }
  .choices label { display: flex; gap: 0.45rem; align-items: baseline; padding: 0.45rem 0.6rem; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; overflow-wrap: anywhere; min-width: 0; }
  .choices label.on { border-color: var(--accent); }
  .src { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--accent); font-weight: 600; flex: none; }
  .note { margin: 0; padding: 0.6rem 0.8rem; border-radius: 10px; background: var(--surface-2); color: var(--muted); }
</style>
