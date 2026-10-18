<script lang="ts">
  // Inhalt oder Profil melden (geht an die Admins der Instanz); danach Blockieren anbieten
  import { api } from '../lib/api.ts';
  import { t, type Key } from '../lib/i18n.svelte.ts';
  import { reporting, toast, toastError } from '../lib/state.svelte.ts';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';

  const REASONS = ['offensive', 'harassment', 'spam', 'spoiler', 'other'] as const;
  let reason = $state<(typeof REASONS)[number]>('offensive');
  let note = $state('');
  let busy = $state(false);
  let sent = $state(false);
  const target = $derived(reporting.target);

  $effect(() => { if (target) { reason = 'offensive'; note = ''; sent = false; } });

  async function send(e: SubmitEvent) {
    e.preventDefault();
    if (!target) return;
    busy = true;
    try {
      await api.post('/reports', { type: target.type, id: target.id, reason, note: note.trim() || null });
      sent = true;
    } catch (err) { toastError(err); } finally { busy = false; }
  }

  async function block() {
    if (!target) return;
    try {
      await api.post(`/users/${target.userId}/block`, {});
      toast(t('mod.blocked', { name: target.name }));
      reporting.target = null;
      // gesperrte Inhalte verschwinden erst nach dem Neuladen der Ansicht
      setTimeout(() => location.reload(), 600);
    } catch (err) { toastError(err); }
  }
</script>

<Sheet open={!!target} onclose={() => (reporting.target = null)} title={t('mod.reportTitle')}>
  {#if target}
    {#if !sent}
      <form class="stack" onsubmit={send}>
        <p class="muted small">{t(`mod.what.${target.type}` as Key, { name: target.name })}</p>
        <div class="reasons" role="radiogroup" aria-label={t('mod.reason')}>
          {#each REASONS as r}
            <label class="row check"><input type="radio" name="reason" value={r} bind:group={reason} /> {t(`mod.reason.${r}` as Key)}</label>
          {/each}
        </div>
        <label class="field"><span>{t('mod.note')}</span>
          <textarea bind:value={note} rows="3" maxlength="500" placeholder={t('mod.notePh')}></textarea>
        </label>
        <p class="muted small">{t('mod.info')}</p>
        <button class="primary" disabled={busy}><Icon name="flag" size={16} /> {t('mod.send')}</button>
      </form>
    {:else}
      <div class="stack">
        <p>{t('mod.thanks')}</p>
        <p class="muted small">{t('mod.blockOffer', { name: target.name })}</p>
        <div class="row">
          <button class="danger" onclick={block}><Icon name="ban" size={16} /> {t('mod.block', { name: target.name })}</button>
          <button class="ghost" onclick={() => (reporting.target = null)}>{t('common.close')}</button>
        </div>
      </div>
    {/if}
  {/if}
</Sheet>

<style>
  .reasons { display: grid; gap: 0.4rem; }
  .check { display: flex; align-items: center; gap: 0.5rem; font-weight: 500; cursor: pointer; font-size: 0.92rem; }
  .check input { width: auto; margin: 0; flex: none; }
</style>
