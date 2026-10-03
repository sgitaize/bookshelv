<script lang="ts">
  import { api } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t, type Key } from '../lib/i18n.svelte.ts';
  import { parseCsv, convert, type ImportItem, type ImportSource } from '../lib/importers.ts';
  import Icon from '../components/Icon.svelte';

  type Result = { title: string; bookId?: number; result: 'ok' | 'exists' | 'failed'; done?: string[] };

  let source = $state<ImportSource | null>(null);
  let items = $state<ImportItem[]>([]);
  let copies = $state<'owned' | 'all' | 'none'>('owned');
  let reviews = $state(true);
  let wishlist = $state(true);
  let visibility = $state<'instance' | 'private'>('instance');
  let running = $state(false);
  let done = $state(0);
  let results = $state<Result[]>([]);
  let finished = $state(false);

  const counts = $derived({
    read: items.filter(i => i.status === 'read').length,
    reading: items.filter(i => i.status === 'reading').length,
    want: items.filter(i => i.status === 'want').length,
    rated: items.filter(i => i.rating || i.review).length,
    owned: items.filter(i => i.owned).length,
    noIsbn: items.filter(i => !i.isbn).length
  });

  async function pick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const r = convert(parseCsv(await file.text()));
    source = r.source;
    items = r.items;
    results = []; done = 0; finished = false;
    // StoryGraph/Goodreads ohne "besessen"-Angabe: dann lieber alles ins Regal vorschlagen
    copies = r.source === 'generic' || !r.items.some(i => i.owned) ? 'all' : 'owned';
  }

  async function start() {
    running = true;
    results = []; done = 0;
    const options = { copies, reviews, wishlist, visibility };
    // in kleinen Paketen, damit Katalogabfragen nicht in Zeitüberschreitungen laufen
    for (let i = 0; i < items.length; i += 8) {
      try {
        const r = await api.post<{ results: Result[] }>('/import', { items: items.slice(i, i + 8), options });
        results = [...results, ...r.results];
      } catch (e) {
        toastError(e);
        results = [...results, ...items.slice(i, i + 8).map(x => ({ title: x.title ?? x.isbn ?? '?', result: 'failed' as const }))];
      }
      done = Math.min(items.length, i + 8);
    }
    running = false;
    finished = true;
  }

  const summary = $derived({
    ok: results.filter(r => r.result === 'ok').length,
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
      <input type="file" accept=".csv,text/csv" onchange={pick} hidden disabled={running} />
    </label>
    <details class="small muted">
      <summary>{t('imp.howTo')}</summary>
      <p>{t('imp.howGoodreads')}</p>
      <p>{t('imp.howStorygraph')}</p>
      <p>{t('imp.howGeneric')}</p>
    </details>
  </div>

  {#if source && items.length}
    <div class="card stack">
      <h2>{t('imp.preview', { n: items.length, source: t(`imp.src.${source}` as Key) })}</h2>
      <ul class="facts">
        <li>{t('imp.cRead', { n: counts.read })}</li>
        <li>{t('imp.cReading', { n: counts.reading })}</li>
        <li>{t('imp.cWant', { n: counts.want })}</li>
        <li>{t('imp.cRated', { n: counts.rated })}</li>
        {#if source !== 'generic'}<li>{t('imp.cOwned', { n: counts.owned })}</li>{/if}
        {#if counts.noIsbn}<li class="muted">{t('imp.cNoIsbn', { n: counts.noIsbn })}</li>{/if}
      </ul>

      <div class="opt">
        <span class="lbl">{t('imp.copies')}</span>
        <div class="segmented">
          {#if source !== 'generic'}<button class:active={copies === 'owned'} onclick={() => (copies = 'owned')}>{t('imp.copiesOwned')}</button>{/if}
          <button class:active={copies === 'all'} onclick={() => (copies = 'all')}>{t('imp.copiesAll')}</button>
          <button class:active={copies === 'none'} onclick={() => (copies = 'none')}>{t('imp.copiesNone')}</button>
        </div>
      </div>
      {#if counts.want}<label class="row check"><input type="checkbox" bind:checked={wishlist} /> {t('imp.wishlist')}</label>{/if}
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

  {#if finished}
    <div class="card stack">
      <h2>{t('imp.done')}</h2>
      <p>{t('imp.summary', { ok: summary.ok, exists: summary.exists, failed: summary.failed.length })}</p>
      {#if summary.failed.length}
        <details><summary>{t('imp.failedList')}</summary>
          <ul>{#each summary.failed as f}<li>{f.title}</li>{/each}</ul>
        </details>
      {/if}
      <div class="row"><a class="btn primary" href="/library">{t('shelf.mine')}</a><a class="btn" href="/wishlist">{t('wish.title')}</a></div>
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
  .segmented { align-self: start; }
  .bar { height: 10px; border-radius: 6px; background: var(--surface-3); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--progress); transition: width 0.3s; }
</style>
