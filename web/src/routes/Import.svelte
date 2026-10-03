<script lang="ts">
  import { api } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t, fmtDate, type Key } from '../lib/i18n.svelte.ts';
  import { parseCsv, convert, convertMapped, guessMapping, FIELDS, type ImportItem, type ImportSource, type Mapping, type Field } from '../lib/importers.ts';
  import Icon from '../components/Icon.svelte';

  type ConflictField = 'status' | 'finishedAt' | 'rating' | 'review';
  type Conflict = { field: ConflictField; mine: unknown; theirs: unknown };
  type Result = { title: string; bookId?: number; result: 'ok' | 'exists' | 'failed' | 'conflict'; done?: string[]; conflicts?: Conflict[] };
  type Open = { item: ImportItem; title: string; field: ConflictField; mine: unknown; theirs: unknown; pick: 'mine' | 'theirs' };

  let source = $state<ImportSource | null>(null);
  let rows = $state<string[][]>([]);
  let mapping = $state<Mapping | null>(null);
  let appName = $state('');
  let parsed = $state<ImportItem[]>([]);
  const items = $derived(source === 'generic' && mapping ? convertMapped(rows, mapping) : parsed);

  let copies = $state<'owned' | 'all' | 'none'>('owned');
  let reviews = $state(true);
  let wishlist = $state(true);
  let lists = $state(true);
  let visibility = $state<'instance' | 'private'>('instance');
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
    results = []; done = 0; finished = false; open = []; resolved = false;
    copies = r.source === 'generic' || !r.items.some(i => i.owned) ? 'all' : 'owned';
  }

  async function send(batch: ImportItem[], policy: 'ask' | 'mine' | 'theirs') {
    const options = { copies, reviews, wishlist, visibility, lists, conflict: policy };
    return (await api.post<{ results: Result[] }>('/import', { items: batch, options })).results;
  }

  async function start() {
    running = true;
    results = []; done = 0; open = [];
    const all = items;
    // in kleinen Paketen, damit Katalogabfragen nicht in Zeitüberschreitungen laufen
    for (let i = 0; i < all.length; i += 8) {
      const batch = all.slice(i, i + 8);
      try {
        const r = await send(batch, conflict);
        results = [...results, ...r];
        r.forEach((res, j) => res.conflicts?.forEach(c => open.push({ item: batch[j], title: res.title, ...c, pick: 'mine' })));
      } catch (e) {
        toastError(e);
        results = [...results, ...batch.map(x => ({ title: x.title ?? x.isbn ?? '?', result: 'failed' as const }))];
      }
      done = Math.min(all.length, i + 8);
    }
    running = false;
    finished = true;
  }

  /** Entscheidungen anwenden: nur „Import übernehmen“ muss noch einmal gesendet werden */
  async function applyDecisions() {
    running = true;
    const byItem = new Map<ImportItem, ConflictField[]>();
    for (const o of open) if (o.pick === 'theirs') byItem.set(o.item, [...(byItem.get(o.item) ?? []), o.field]);
    const batch = [...byItem].map(([item, resolve]) => ({ ...$state.snapshot(item), resolve }));
    try {
      for (let i = 0; i < batch.length; i += 8) await send(batch.slice(i, i + 8), 'mine');
      resolved = true;
    } catch (e) { toastError(e); } finally { running = false; }
  }

  const setAll = (p: 'mine' | 'theirs') => open.forEach(o => (o.pick = p));
  const show = (f: ConflictField, v: unknown) =>
    v === null || v === undefined || v === '' ? '–'
      : f === 'rating' ? `${String(v).replace('.', ',')} ★`
      : f === 'status' ? t(`read.${v}` as Key)
      : f === 'finishedAt' ? fmtDate(String(v))
      : String(v).length > 120 ? String(v).slice(0, 120) + '…' : String(v);

  const summary = $derived({
    ok: results.filter(r => r.result === 'ok' || r.result === 'conflict').length,
    exists: results.filter(r => r.result === 'exists').length,
    failed: results.filter(r => r.result === 'failed')
  });
</script>

<section class="stack">
  <h1>{t('imp.title')}</h1>
  <p class="muted">{t('imp.intro')}</p>

  <div class="card stack">
    <label class="btn primary pick">
      <Icon name="download" size={16} /> {t('imp.pick')}
      <input type="file" accept=".csv,.tsv,.txt,text/csv" onchange={pick} hidden disabled={running} />
    </label>
    <details class="small muted">
      <summary>{t('imp.howTo')}</summary>
      <p>{t('imp.howGoodreads')}</p>
      <p>{t('imp.howStorygraph')}</p>
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
        <li>{t('imp.cWant', { n: counts.want })}</li>
        <li>{t('imp.cRated', { n: counts.rated })}</li>
        {#if source !== 'generic' || mapping?.owned !== -1}<li>{t('imp.cOwned', { n: counts.owned })}</li>{/if}
        {#if counts.listed}<li>{t('imp.cListed', { n: counts.listed })}</li>{/if}
        {#if counts.noIsbn}<li class="muted">{t('imp.cNoIsbn', { n: counts.noIsbn })}</li>{/if}
      </ul>

      <div class="opt">
        <span class="lbl">{t('imp.copies')}</span>
        <div class="segmented">
          {#if source !== 'generic' || mapping?.owned !== -1}<button class:active={copies === 'owned'} onclick={() => (copies = 'owned')}>{t('imp.copiesOwned')}</button>{/if}
          <button class:active={copies === 'all'} onclick={() => (copies = 'all')}>{t('imp.copiesAll')}</button>
          <button class:active={copies === 'none'} onclick={() => (copies = 'none')}>{t('imp.copiesNone')}</button>
        </div>
      </div>

      <div class="opt">
        <span class="lbl">{t('imp.conflict')}</span>
        <div class="segmented wrap">
          <button class:active={conflict === 'ask'} onclick={() => (conflict = 'ask')}>{t('imp.conflictAsk')}</button>
          <button class:active={conflict === 'mine'} onclick={() => (conflict = 'mine')}>{t('imp.conflictMine')}</button>
          <button class:active={conflict === 'theirs'} onclick={() => (conflict = 'theirs')}>{t('imp.conflictTheirs', { app })}</button>
        </div>
        <span class="muted small">{t('imp.conflictInfo')}</span>
      </div>

      {#if counts.want}<label class="row check"><input type="checkbox" bind:checked={wishlist} /> {t('imp.wishlist')}</label>{/if}
      {#if counts.listed}<label class="row check"><input type="checkbox" bind:checked={lists} /> {t('imp.lists')}</label>{/if}
      {#if counts.rated}
        <label class="row check"><input type="checkbox" bind:checked={reviews} /> {t('imp.reviews')}</label>
        {#if reviews}
          <div class="segmented">
            <button class:active={visibility === 'instance'} onclick={() => (visibility = 'instance')}>{t('vis.instance')}</button>
            <button class:active={visibility === 'private'} onclick={() => (visibility = 'private')}>{t('vis.private')}</button>
          </div>
        {/if}
      {/if}

      {#if running || finished}
        <div class="bar"><span style="width: {(done / items.length) * 100}%"></span></div>
        <p class="small muted">{t('imp.progress', { n: done, total: items.length })}</p>
      {/if}
      {#if !finished}
        <button class="primary" onclick={start} disabled={running}>{running ? t('imp.running') : t('imp.start', { n: items.length })}</button>
      {/if}
    </div>
  {:else if source}
    <p class="empty">{t('imp.empty')}</p>
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
      {#if summary.failed.length}
        <details><summary>{t('imp.failedList')}</summary>
          <ul>{#each summary.failed as f}<li>{f.title}</li>{/each}</ul>
        </details>
      {/if}
      <div class="row"><a class="btn primary" href="/library">{t('shelf.mine')}</a><a class="btn" href="/lists">{t('list.title')}</a><a class="btn" href="/wishlist">{t('wish.title')}</a></div>
    </div>
  {/if}
</section>

<style>
  section { max-width: 720px; margin: 0 auto; }
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
</style>
