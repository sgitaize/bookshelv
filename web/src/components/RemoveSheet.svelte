<script lang="ts">
  import { api, type RemoveReason } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { t, type Key } from '../lib/i18n.svelte.ts';
  import Sheet from './Sheet.svelte';

  // Exemplar entfernen: ins Archiv (mit Grund, Verlauf bleibt) oder endgültig löschen (Verlauf weg)
  let { copyId, title, archivedOnly = false, onclose, onsaved }: {
    copyId: number | null; title: string; archivedOnly?: boolean; onclose: () => void; onsaved: () => void;
  } = $props();

  let mode = $state<'archive' | 'purge'>('archive');
  let reason = $state<RemoveReason>('sold');
  let busy = $state(false);

  $effect(() => { if (copyId !== null) { mode = archivedOnly ? 'purge' : 'archive'; reason = 'sold'; } });

  async function confirm() {
    if (copyId === null) return;
    busy = true;
    try {
      await api.del(`/copies/${copyId}`, mode === 'purge' ? { mode } : { mode, reason });
      toast(t(mode === 'purge' ? 'rm.purged' : 'rm.archived'));
      onsaved();
      onclose();
    } catch (e) { toastError(e); } finally { busy = false; }
  }
</script>

<Sheet open={copyId !== null} {onclose} title={t('rm.title')}>
  <div class="stack">
    <p class="muted small book">{title}</p>
    {#if !archivedOnly}
      <label class="opt" class:sel={mode === 'archive'}>
        <input type="radio" bind:group={mode} value="archive" />
        <span><strong>{t('rm.archive')}</strong><small>{t('rm.archiveInfo')}</small></span>
      </label>
      {#if mode === 'archive'}
        <div class="reasons">
          <span class="lbl">{t('rm.reason')}</span>
          <div class="segmented">
            {#each ['sold', 'given_away', 'lost', 'other'] as const as r}
              <button type="button" class:active={reason === r} onclick={() => (reason = r)}>{t(`rm.${r}` as Key)}</button>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
    <label class="opt danger-opt" class:sel={mode === 'purge'}>
      <input type="radio" bind:group={mode} value="purge" />
      <span><strong>{t('rm.purge')}</strong><small>{t('rm.purgeWarn')}</small></span>
    </label>
    <button class={mode === 'purge' ? 'danger-btn' : 'primary'} onclick={confirm} disabled={busy}>
      {mode === 'purge' ? t('rm.confirmPurge') : t('rm.confirmArchive')}
    </button>
  </div>
</Sheet>

<style>
  .book { margin: 0; font-weight: 500; }
  .opt { display: flex; gap: 0.7rem; align-items: flex-start; padding: 0.8rem; border: 1px solid var(--line); border-radius: 12px; cursor: pointer; }
  .opt.sel { border-color: var(--accent); background: var(--accent-soft); }
  .danger-opt.sel { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
  .opt input { width: 18px; height: 18px; margin-top: 0.15rem; accent-color: var(--accent); }
  .opt span { display: grid; gap: 0.2rem; }
  .opt small { color: var(--muted); font-size: 0.82rem; line-height: 1.4; }
  .reasons { display: grid; gap: 0.35rem; padding-left: 0.4rem; }
  .lbl { font-size: 0.85rem; color: var(--muted); }
  .danger-btn { background: var(--danger); color: #fff; border-color: transparent; }
</style>
