<script lang="ts">
  import { api, type BookBrief } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import BookPicker from './BookPicker.svelte';

  let { open, current, onclose, onsaved }: { open: boolean; current: BookBrief[]; onclose: () => void; onsaved: (top: BookBrief[]) => void } = $props();
  let picks = $state<BookBrief[]>([]);
  let busy = $state(false);
  $effect(() => { if (open) picks = [...current]; });

  const move = (i: number, d: number) => {
    const p = [...picks];
    [p[i], p[i + d]] = [p[i + d], p[i]];
    picks = p;
  };

  async function save() {
    busy = true;
    try {
      const top = await api.put<BookBrief[]>('/me/top', { bookIds: picks.map(b => b.id) });
      toast(t('top.saved'));
      onsaved(top);
    } catch (e) { toastError(e); } finally { busy = false; }
  }
</script>

<Sheet {open} {onclose} title={t('top.edit')}>
  <ol class="picks">
    {#each picks as b, i (b.id)}
      <li>
        <span class="rank">{i + 1}</span>
        <span class="grow">{b.title}</span>
        <button class="icon ghost" disabled={i === 0} onclick={() => move(i, -1)} aria-label={t('list.up')}><Icon name="up" size={18} /></button>
        <button class="icon ghost" disabled={i === picks.length - 1} onclick={() => move(i, 1)} aria-label={t('list.down')}><Icon name="down" size={18} /></button>
        <button class="icon ghost" onclick={() => (picks = picks.filter(x => x.id !== b.id))} aria-label={t('list.remove')}><Icon name="x" size={18} /></button>
      </li>
    {/each}
  </ol>
  {#if picks.length < 5}
    <p class="muted small">{t('top.pickHint', { n: 5 - picks.length })}</p>
    <BookPicker exclude={picks.map(b => b.id)} onpick={b => (picks = [...picks, b])} />
  {/if}
  <div class="row actions">
    <button class="primary" onclick={save} disabled={busy}>{t('common.save')}</button>
  </div>
</Sheet>

<style>
  .picks { list-style: none; padding: 0; margin: 0 0 0.8rem; display: grid; gap: 0.3rem; }
  .picks li { display: flex; align-items: center; gap: 0.4rem; background: var(--surface-2); border-radius: 10px; padding: 0.3rem 0.5rem; }
  .rank { font-weight: 700; color: var(--accent); width: 1.4rem; text-align: center; }
  .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { justify-content: flex-end; margin-top: 1rem; }
</style>
