<script lang="ts">
  import { api, type ReadingListSummary, type ListVisibility } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import ListCard from '../components/ListCard.svelte';
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
    <div class="grid">{#each lists as l (l.id)}<ListCard list={l} />{/each}</div>
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
  .grid { display: grid; gap: 0.7rem; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .segmented { justify-self: start; }
</style>
