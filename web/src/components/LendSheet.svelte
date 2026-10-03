<script lang="ts">
  import { api } from '../lib/api.ts';
  import { session, toast, toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Sheet from './Sheet.svelte';

  // Exemplar verleihen: an einen Nutzer der Instanz oder an jemanden ohne Konto (Name nur für den Verleiher)
  let { copyId, title, onclose, onsaved }: { copyId: number | null; title: string; onclose: () => void; onsaved: () => void } = $props();

  type Person = { id: number; displayName: string; username: string };
  let people = $state<Person[]>([]);
  let instances = $state<{ id: number; url: string; name: string | null }[]>([]);
  let handle = $state('');
  let borrower = $state<string>('');          // Nutzer-ID oder 'other'
  let name = $state('');
  let due = $state('');
  let note = $state('');
  let busy = $state(false);

  $effect(() => {
    if (copyId === null) return;
    borrower = ''; name = ''; due = ''; note = ''; handle = '';
    api.get<Person[]>('/users').then(r => (people = r.filter(p => p.id !== session.me?.id))).catch(toastError);
    api.get<typeof instances>('/federation/instances').then(r => (instances = r)).catch(() => {});
  });

  function inDays(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (copyId === null) return;
    busy = true;
    try {
      const other = borrower === 'other';
      const remote = borrower === 'remote';
      await api.post(`/copies/${copyId}/loans`, {
        borrowerId: other || remote ? null : Number(borrower) || null,
        borrowerName: other ? name : null,
        borrowerHandle: remote ? handle : null,
        dueAt: due || null,
        note: note || null
      });
      const who = other ? name : remote ? handle : people.find(p => String(p.id) === borrower)?.displayName ?? '';
      toast(t('loan.lent', { title, name: who }));
      onsaved();
      onclose();
    } catch (err) { toastError(err); } finally { busy = false; }
  }
</script>

<Sheet open={copyId !== null} {onclose} title={t('loan.lendTitle')}>
  <form class="stack" onsubmit={save}>
    <p class="muted small book">{title}</p>
    <label class="field">
      <span>{t('loan.to')}</span>
      <select bind:value={borrower} required>
        <option value="" disabled>{t('loan.pick')}</option>
        {#each people as p (p.id)}<option value={String(p.id)}>{p.displayName} (@{p.username})</option>{/each}
        <option value="other">{t('loan.other')}</option>
        {#if instances.length}<option value="remote">{t('loan.remote')}</option>{/if}
      </select>
    </label>
    {#if borrower === 'other'}
      <label class="field">
        <span>{t('loan.name')}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={name} required maxlength="80" placeholder={t('loan.namePh')} autofocus />
        <small>{t('loan.nameHint')}</small>
      </label>
    {/if}
    {#if borrower === 'remote'}
      <label class="field">
        <span>{t('loan.handle')}</span>
        <input bind:value={handle} required placeholder={t('loan.handlePh')} autocapitalize="off" spellcheck="false" />
        <small>{t('loan.handleHint', { list: instances.map(i => i.name ?? new URL(i.url).host).join(', ') })}</small>
      </label>
    {/if}
    <div class="field">
      <span class="lbl">{t('loan.due')}</span>
      <div class="row quick">
        <button type="button" class:active={!due} onclick={() => (due = '')}>{t('loan.noDue')}</button>
        <button type="button" class:active={due === inDays(14)} onclick={() => (due = inDays(14))}>{t('loan.in2w')}</button>
        <button type="button" class:active={due === inDays(30)} onclick={() => (due = inDays(30))}>{t('loan.in1m')}</button>
        <button type="button" class:active={due === inDays(91)} onclick={() => (due = inDays(91))}>{t('loan.in3m')}</button>
      </div>
      <input type="date" bind:value={due} min={new Date().toISOString().slice(0, 10)} />
    </div>
    <label class="field"><span>{t('loan.note')}</span><input bind:value={note} maxlength="500" /></label>
    <button class="primary" disabled={busy}>{t('loan.lend')}</button>
  </form>
</Sheet>

<style>
  .book { margin: 0; font-weight: 500; }
  .lbl { font-size: 0.88rem; color: var(--muted); font-weight: 500; }
  .field { display: grid; gap: 0.35rem; }
  small { color: var(--muted); font-size: 0.8rem; }
  .quick { gap: 0.4rem; }
  .quick button { padding: 0.35em 0.8em; font-size: 0.85rem; border-radius: 999px; }
  .quick button.active { background: var(--accent); color: var(--accent-ink); }
</style>
