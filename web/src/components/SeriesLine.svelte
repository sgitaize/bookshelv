<script lang="ts">
  // Reihe/Band auf der Buchseite: Link zur Reihe, „Als Nächstes“-Hinweis, Reihe von Hand setzen/korrigieren
  import { api, seriesHref, type Book, type Series } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';

  let { book, onchange }: { book: Book; onchange: (b: Book) => void } = $props();

  let series = $state<Series | null>(null);
  let editing = $state(false);
  let name = $state('');
  let index = $state('');

  $effect(() => {
    series = null;
    if (book.series) api.get<Series>(`/series?name=${encodeURIComponent(book.series)}`).then(r => (series = r)).catch(() => {});
  });

  const next = $derived(series?.next && series.next.id !== book.id ? series.next : null);
  const fmtIdx = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

  function edit() {
    name = book.series ?? '';
    index = book.seriesIndex == null ? '' : String(book.seriesIndex);
    editing = true;
  }
  async function save() {
    try {
      onchange(await api.put<Book>(`/books/${book.id}/series`, { name: name.trim() || null, index: index.trim() || null }));
      editing = false;
    } catch (e) { toastError(e); }
  }
</script>

{#if editing}
  <form class="edit" onsubmit={e => { e.preventDefault(); save(); }}>
    <input bind:value={name} maxlength="200" placeholder={t('series.namePh')} aria-label={t('series.name')} />
    <input bind:value={index} inputmode="decimal" class="idx" placeholder={t('series.indexPh')} aria-label={t('series.index')} />
    <button class="primary small">{t('common.save')}</button>
    <button type="button" class="ghost small" onclick={() => (editing = false)}>{t('common.cancel')}</button>
  </form>
{:else if book.series}
  <p class="line">
    <Icon name="library" size={15} />
    <a href={seriesHref(book.series)}>{book.seriesIndex != null ? t('series.volumeOf', { n: fmtIdx(book.seriesIndex), name: book.series }) : book.series}</a>
    {#if series && series.books.length > 1}<span class="muted small">({t('series.known', { n: series.books.length })})</span>{/if}
    <button class="icon ghost tiny" onclick={edit} aria-label={t('series.edit')}><Icon name="edit" size={14} /></button>
  </p>
  {#if next}
    <a class="card next" href="/book/{next.id}">
      <Cover url={next.coverUrl} title={next.title} authors={next.authors} size="sm" />
      <span class="grow">
        <span class="kicker">{t('series.next')}</span>
        <strong>{next.index != null ? `${fmtIdx(next.index)}. ` : ''}{next.title}</strong>
        <span class="muted small">{next.owned ? t('series.owned') : next.friends ? t('series.friendsHave', { n: next.friends }) : t('series.notOwned')}</span>
      </span>
      <Icon name="arrow" size={16} />
    </a>
  {/if}
{:else}
  <button class="ghost small add" onclick={edit}><Icon name="plus" size={14} /> {t('series.add')}</button>
{/if}

<style>
  .line { margin: 0.3rem 0; line-height: 1.8; }
  .line :global(svg), .line button { vertical-align: middle; }
  .line a { font-weight: 600; overflow-wrap: anywhere; }
  .line .muted { white-space: nowrap; }
  .tiny { padding: 0.2rem; }
  .edit { display: flex; gap: 0.4rem; flex-wrap: wrap; margin: 0.4rem 0; }
  .edit input { flex: 1 1 12rem; min-width: 0; }
  .edit .idx { flex: 0 1 6rem; }
  .next { display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 0.8rem; margin: 0.5rem 0; color: var(--text); }
  .next:hover { text-decoration: none; }
  .next .grow { display: grid; gap: 0.1rem; min-width: 0; flex: 1; }
  .next strong { overflow-wrap: anywhere; }
  .kicker { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  .add { justify-self: start; align-self: flex-start; margin: 0.3rem 0; }
</style>
