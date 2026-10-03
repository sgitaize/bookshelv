<script lang="ts">
  import { api } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Sheet from './Sheet.svelte';

  // „Zur Leseliste“ auf der Buchseite: eigene Listen an-/abhaken oder neue anlegen
  let { bookId, open, onclose }: { bookId: number; open: boolean; onclose: () => void } = $props();
  let mine = $state<{ id: number; name: string; visibility: string; has: boolean; ownerName: string | null }[] | null>(null);
  let name = $state('');

  const load = () => api.get<{ mine: NonNullable<typeof mine> }>(`/books/${bookId}/lists`).then(r => (mine = r.mine)).catch(toastError);
  $effect(() => { if (open) load(); });

  async function toggle(l: { id: number; has: boolean }) {
    try {
      if (l.has) await api.del(`/lists/${l.id}/books/${bookId}`);
      else await api.put(`/lists/${l.id}/books/${bookId}`, {});
      l.has = !l.has;
    } catch (e) { toastError(e); }
  }
  async function create(e: SubmitEvent) {
    e.preventDefault();
    try {
      await api.post('/lists', { name, bookId });
      toast(t('list.createdWith', { name }));
      name = '';
      load();
    } catch (err) { toastError(err); }
  }
</script>

<Sheet {open} {onclose} title={t('list.addTo')}>
  {#if mine === null}
    <div class="spinner"></div>
  {:else}
    <div class="ls">
      {#each mine as l (l.id)}
        <label class="row check"><input type="checkbox" checked={l.has} onchange={() => toggle(l)} /> {l.name}{#if l.ownerName} <span class="muted small">· {t('list.byOwner', { name: l.ownerName })}</span>{:else if l.visibility === 'private'} <span class="muted small">· {t('vis.private')}</span>{/if}</label>
      {/each}
    </div>
    <form class="row newl" onsubmit={create}>
      <input bind:value={name} required maxlength="80" placeholder={t('list.namePh')} />
      <button class="primary">{t('list.create')}</button>
    </form>
  {/if}
</Sheet>

<style>
  .ls { display: grid; gap: 0.45rem; margin-bottom: 1rem; }
  .check { cursor: pointer; font-weight: 500; }
  .newl { flex-wrap: nowrap; }
  .newl input { flex: 1; min-width: 0; }
</style>
