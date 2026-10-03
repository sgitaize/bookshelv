<script lang="ts">
  import { api, type ReadingListSummary, type ListVisibility } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, tn } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Icon from '../components/Icon.svelte';

  let lists = $state<ReadingListSummary[] | null>(null);
  let creating = $state(false);
  let form = $state({ name: '', description: '', visibility: 'instance' as ListVisibility });

  $effect(() => { api.get<ReadingListSummary[]>('/lists').then(r => (lists = r)).catch(toastError); });

  async function create(e: SubmitEvent) {
    e.preventDefault();
    try {
      const r = await api.post<{ id: number }>('/lists', form);
      router.go(`/lists/${r.id}`);
    } catch (err) { toastError(err); }
  }
</script>

<section class="stack">
  <div class="spread">
    <h1>{t('list.title')}</h1>
    <button class="primary" onclick={() => (creating = true)}><Icon name="plus" size={16} /> {t('list.new')}</button>
  </div>
  <p class="muted">{t('list.intro')}</p>
  {#if lists === null}
    <div class="spinner"></div>
  {:else if !lists.length}
    <p class="empty">{t('list.hint')}</p>
  {:else}
    <!-- eine Liste pro Zeile, Bücher seitlich scrollbar (wie die Reihen auf der Startseite) -->
    {#each lists as l (l.id)}
      <div class="lrow">
        <div class="section-head">
          <a class="lname" href="/lists/{l.id}">
            <h2>{l.name}</h2>
            <span class="muted small">{tn('list.books', l.count)}{#if l.visibility === 'private'} · {t('vis.private')}{/if}</span>
          </a>
          <a href="/lists/{l.id}" aria-label={l.name}><Icon name="arrow" size={22} /></a>
        </div>
        {#if l.preview.length}
          <div class="book-row">
            {#each l.preview as b (b.id)}
              <a href="/book/{b.id}" title={b.title}><Cover url={b.coverUrl} title={b.title} authors={b.authors} /></a>
            {/each}
            {#if l.count > l.preview.length}
              <a class="more" href="/lists/{l.id}"><span>+{l.count - l.preview.length}</span></a>
            {/if}
          </div>
        {:else}
          <a class="muted small" href="/lists/{l.id}">{t('list.emptyRow')}</a>
        {/if}
      </div>
    {/each}
  {/if}
</section>

<Sheet open={creating} onclose={() => (creating = false)} title={t('list.new')}>
  <form class="stack" onsubmit={create}>
    <label class="field"><span>{t('list.name')}</span><input bind:value={form.name} required maxlength="80" placeholder={t('list.namePh')} /></label>
    <label class="field"><span>{t('list.description')}</span><textarea bind:value={form.description} maxlength="1000" rows="3"></textarea></label>
    <div class="segmented">
      <button type="button" class:active={form.visibility === 'instance'} onclick={() => (form.visibility = 'instance')}>{t('list.visPublic')}</button>
      <button type="button" class:active={form.visibility === 'private'} onclick={() => (form.visibility = 'private')}>{t('vis.private')}</button>
    </div>
    <button class="primary">{t('list.create')}</button>
  </form>
</Sheet>

<style>
  .lrow { padding-bottom: 0.4rem; border-bottom: 1px solid var(--line); }
  .lrow:last-child { border-bottom: none; }
  .lname { display: grid; gap: 0.1rem; min-width: 0; color: inherit; }
  .lname:hover { text-decoration: none; }
  .lname h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1.1rem; }
  .more { display: grid; place-items: center; aspect-ratio: 2 / 3; border-radius: 6px; background: var(--surface-2); color: var(--muted); font-weight: 600; }
  .more:hover { text-decoration: none; color: var(--text); }
  .segmented { justify-self: start; }
</style>
