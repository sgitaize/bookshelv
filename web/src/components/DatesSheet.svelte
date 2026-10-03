<script lang="ts">
  import { api, type Reading } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Sheet from './Sheet.svelte';

  // Begonnen/Gelesen am nachträglich ändern; just = gerade erst als gelesen markiert (anderer Titel)
  let { bookId, reading, open, just = false, onclose, onsaved }:
    { bookId: number; reading: Reading; open: boolean; just?: boolean; onclose: () => void; onsaved: (r: Reading) => void } = $props();
  let started = $state('');
  let finished = $state('');
  let busy = $state(false);
  const today = new Date().toISOString().slice(0, 10);
  const done = $derived(reading.status === 'read' || reading.status === 'dnf');

  $effect(() => { if (open) { started = reading.startedAt ?? ''; finished = reading.finishedAt ?? ''; } });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const r = await api.put<Reading>(`/books/${bookId}/reading`, { startedAt: started || null, ...(done ? { finishedAt: finished || null } : {}) });
      onsaved(r);
    } catch (err) { toastError(err); } finally { busy = false; }
  }
</script>

<Sheet {open} {onclose} title={just ? (reading.status === 'dnf' ? t('dates.whenDnf') : t('dates.whenRead')) : t('dates.edit')}>
  <form class="stack" onsubmit={save}>
    {#if done}
      <label class="field"><span>{reading.status === 'dnf' ? t('dates.dnfOn') : t('dates.finishedOn')}</span>
        <input type="date" bind:value={finished} max={today} min={started || undefined} />
      </label>
    {/if}
    <label class="field"><span>{t('dates.startedOn')}</span>
      <input type="date" bind:value={started} max={finished || today} />
    </label>
    <p class="muted small">{t('dates.info')}</p>
    <div class="row acts">
      {#if done}<button type="button" class="ghost small" onclick={() => (finished = '')}>{t('dates.unknown')}</button>{/if}
      <span class="grow"></span>
      <button class="primary" disabled={busy}>{t('common.save')}</button>
    </div>
  </form>
</Sheet>

<style>
  .acts { align-items: center; }
  .grow { flex: 1; }
</style>
