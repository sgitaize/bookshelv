<script lang="ts">
  // /series?name=… : alle Bände einer Reihe; /series : meine Reihen mit Fortschritt und nächstem Band
  import { api, labels, seriesHref, type Series, type MySeries } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';

  const name = $derived(router.query.get('name'));
  let one = $state<Series | null>(null);
  let all = $state<MySeries[] | null>(null);

  $effect(() => {
    one = null; all = null;
    if (name) api.get<Series>(`/series?name=${encodeURIComponent(name)}`).then(r => (one = r)).catch(toastError);
    else api.get<MySeries[]>('/me/series').then(r => (all = r)).catch(toastError);
  });
  const fmtIdx = (n: number | null) => (n == null ? '–' : String(n).replace('.', ','));
</script>

{#if name}
  <section class="stack">
    <a href="/series" class="small back"><Icon name="back" size={14} /> {t('series.mine')}</a>
    {#if !one}
      <div class="spinner"></div>
    {:else}
      <h1>{one.name}</h1>
      <p class="muted">{t('series.progress', { r: one.books.filter(b => b.status === 'read').length, n: one.books.length })}</p>
      <ol class="vols">
        {#each one.books as b (b.id)}
          <li>
            <a class="card vol" class:next={one.next?.id === b.id} href="/book/{b.id}">
              <span class="idx">{fmtIdx(b.index)}</span>
              <Cover url={b.coverUrl} title={b.title} authors={b.authors} size="sm" />
              <span class="grow">
                <strong>{b.title}</strong>
                <span class="muted small">{[b.year, b.authors[0]].filter(Boolean).join(' · ')}</span>
                <span class="small chips">
                  <span class="chip st {b.status}">{labels.read[b.status]}</span>
                  {#if b.owned}<span class="chip">{t('series.owned')}</span>{:else if b.friends}<span class="chip">{t('series.friendsHave', { n: b.friends })}</span>{/if}
                  {#if one.next?.id === b.id}<span class="chip nextchip">{t('series.next')}</span>{/if}
                </span>
              </span>
            </a>
          </li>
        {/each}
      </ol>
      <p class="muted small">{t('series.missingHint')}</p>
    {/if}
  </section>
{:else}
  <section class="stack">
    <h1>{t('series.mine')}</h1>
    {#if !all}
      <div class="spinner"></div>
    {:else if !all.length}
      <p class="empty">{t('series.none')}</p>
    {:else}
      <div class="grid">
        {#each all as s (s.name)}
          <a class="card ser" href={seriesHref(s.name)}>
            <span class="stackcv">{#each s.covers.slice(0, 4) as c (c.id)}<span class="cv" class:done={c.status === 'read'}><Cover url={c.coverUrl} title={c.title} size="sm" /></span>{/each}</span>
            <strong class="nm">{s.name}</strong>
            <span class="bar" aria-hidden="true"><span style="width: {Math.round((s.read / Math.max(1, s.total)) * 100)}%"></span></span>
            <span class="muted small">{t('series.progress', { r: s.read, n: s.total })}</span>
            {#if s.next}<span class="small nx">{t('series.nextShort', { title: s.next.title })}</span>{/if}
          </a>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .back { display: inline-flex; align-items: center; gap: 0.3rem; }
  h1 { overflow-wrap: anywhere; margin-bottom: 0; }
  .vols { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .vol { display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 0.8rem; color: var(--text); }
  .vol:hover { text-decoration: none; }
  .vol.next { border-color: var(--accent); }
  .idx { width: 2.2rem; text-align: center; font-weight: 700; color: var(--accent); flex-shrink: 0; }
  .grow { display: grid; gap: 0.2rem; min-width: 0; flex: 1; }
  .grow strong { overflow-wrap: anywhere; }
  .chips { display: flex; gap: 0.3rem; flex-wrap: wrap; }
  .st.read { background: color-mix(in srgb, var(--accent) 25%, transparent); }
  .nextchip { color: var(--accent); }
  .grid { display: grid; gap: 0.7rem; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  @media (max-width: 400px) { .grid { grid-template-columns: 1fr; } }
  .ser { display: grid; gap: 0.4rem; padding: 0.9rem; color: var(--text); }
  .ser:hover { text-decoration: none; }
  .stackcv { display: flex; }
  .stackcv .cv { margin-right: -14px; }
  .stackcv .cv:not(.done) { filter: saturate(0.4) brightness(0.8); }
  .nm { overflow-wrap: anywhere; margin-top: 0.3rem; }
  .bar { height: 6px; border-radius: 3px; background: var(--surface-3); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); }
  .nx { color: var(--accent); overflow-wrap: anywhere; }
</style>
