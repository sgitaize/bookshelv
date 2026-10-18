<script lang="ts">
  // Weitere Lektüre anlegen oder bearbeiten: Zeitraum (ohne Ende = liest gerade wieder) und optionale Bewertung
  import { api, type Reread } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t, i18n } from '../lib/i18n.svelte.ts';
  import Sheet from './Sheet.svelte';
  import Stars from './Stars.svelte';

  let { bookId, reread, open, onclose, onsaved }:
    { bookId: number; reread: Reread | null; open: boolean; onclose: () => void; onsaved: (list: Reread[]) => void } = $props();
  const today = new Date().toISOString().slice(0, 10);
  let started = $state('');
  let finished = $state('');
  let rating = $state<number | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    started = reread ? reread.startedAt ?? '' : today;
    finished = reread?.finishedAt ?? '';
    rating = reread?.rating ?? null;
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const v = { startedAt: started || null, finishedAt: finished || null, rating };
      onsaved(reread ? await api.patch<Reread[]>(`/rereads/${reread.id}`, v) : await api.post<Reread[]>(`/books/${bookId}/rereads`, v));
    } catch (err) { toastError(err); } finally { busy = false; }
  }

  async function remove() {
    if (!reread || !confirm(t('reread.deleteQ'))) return;
    try { onsaved(await api.del<Reread[]>(`/rereads/${reread.id}`)); } catch (err) { toastError(err); }
  }
</script>

<Sheet {open} {onclose} title={reread ? t('reread.edit') : t('reread.add')}>
  <form class="stack" onsubmit={save}>
    <label class="field"><span>{t('dates.startedOn')}</span>
      <input type="date" bind:value={started} max={finished || today} />
    </label>
    <label class="field"><span>{t('dates.finishedOn')}</span>
      <input type="date" bind:value={finished} max={today} min={started || undefined} />
    </label>
    <p class="muted small">{t('reread.info')}</p>
    <div class="rate">
      <Stars value={rating} size={32} onchange={v => (rating = v)} />
      <span class="muted small">{rating ? `${rating.toLocaleString(i18n.locale)} / 5` : t('reread.rateOptional')}</span>
    </div>
    <div class="row acts">
      {#if reread}<button type="button" class="ghost danger small" onclick={remove}>{t('common.delete')}</button>{/if}
      <span class="grow"></span>
      <button class="primary" disabled={busy}>{t('common.save')}</button>
    </div>
  </form>
</Sheet>

<style>
  .rate { display: grid; justify-items: center; gap: 0.3rem; }
  .acts { align-items: center; }
  .grow { flex: 1; }
</style>
