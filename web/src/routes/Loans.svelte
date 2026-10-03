<script lang="ts">
  import { api, type Loan, type Loans } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, fmtDate } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';

  type Tab = 'lent' | 'borrowed' | 'history';
  let tab = $state<Tab>((router.query.get('tab') as Tab) ?? 'lent');
  let data = $state<Loans | null>(null);
  let editingDue = $state<number | null>(null);
  let dueValue = $state('');

  const load = () => api.get<Loans>('/loans').then(r => (data = r)).catch(toastError);
  $effect(() => { load(); });

  const list = $derived(data ? data[tab] : []);

  async function giveBack(l: Loan) {
    try {
      await api.post(`/loans/${l.id}/return`, {});
      toast(t('loan.returned'));
      await load();
    } catch (e) { toastError(e); }
  }

  async function saveDue(l: Loan) {
    try {
      await api.patch(`/loans/${l.id}`, { dueAt: dueValue || null });
      editingDue = null;
      await load();
    } catch (e) { toastError(e); }
  }

  async function remove(l: Loan) {
    if (!confirm(t('loan.deleteQ'))) return;
    try { await api.del(`/loans/${l.id}`); await load(); } catch (e) { toastError(e); }
  }
</script>

<section class="stack">
  <h1>{t('loan.title')}</h1>

  <div class="segmented tabs">
    <button class:active={tab === 'lent'} onclick={() => (tab = 'lent')}>{t('loan.tabLent', { n: data?.lent.length ?? 0 })}</button>
    <button class:active={tab === 'borrowed'} onclick={() => (tab = 'borrowed')}>{t('loan.tabBorrowed', { n: data?.borrowed.length ?? 0 })}</button>
    <button class:active={tab === 'history'} onclick={() => (tab = 'history')}>{t('loan.tabHistory')}</button>
  </div>

  {#if !data}
    <div class="spinner"></div>
  {:else if !list.length}
    <p class="empty">{tab === 'lent' ? t('loan.noneLent') : tab === 'borrowed' ? t('loan.noneBorrowed') : t('loan.noneHistory')}</p>
  {:else}
    <div class="list">
      {#each list as l (l.id)}
        <article class="card loan" class:overdue={l.overdue}>
          <a href="/book/{l.book.id}" class="cv"><Cover url={l.book.coverUrl} title={l.book.title} authors={l.book.authors} size="sm" /></a>
          <div class="body">
            <a href="/book/{l.book.id}" class="title">{l.book.title}</a>
            <p class="who">
              {#if l.mine}{t('loan.toName', { name: !l.borrower || l.borrower.displayName === '–' ? t('loan.deletedAccount') : l.borrower.displayName })}{:else}{t('loan.from', { name: l.lender.displayName })}{/if}
              · {t('loan.since', { d: fmtDate(l.lentAt) })}
            </p>
            {#if l.returnedAt}
              <p class="muted small">{t('loan.returnedOn', { d: fmtDate(l.returnedAt) })}</p>
            {:else if l.dueAt}
              <p class="due small">{l.overdue ? t('loan.overdue', { d: fmtDate(l.dueAt) }) : t('loan.dueOn', { d: fmtDate(l.dueAt) })}</p>
            {/if}
            {#if l.note}<p class="muted small note">{l.note}</p>{/if}

            {#if editingDue === l.id}
              <div class="row">
                <input type="date" bind:value={dueValue} min={l.lentAt} class="grow" />
                <button class="primary" onclick={() => saveDue(l)}>{t('common.save')}</button>
              </div>
            {:else if !l.returnedAt}
              <div class="row acts">
                <button class="primary small" onclick={() => giveBack(l)}><Icon name="check" size={16} /> {l.mine ? t('loan.back') : t('loan.gaveBack')}</button>
                {#if l.mine}
                  <button class="ghost small" onclick={() => { editingDue = l.id; dueValue = l.dueAt ?? ''; }}>{t('loan.editDue')}</button>
                  <button class="icon ghost danger" onclick={() => remove(l)} aria-label={t('common.delete')}><Icon name="trash" size={16} /></button>
                {/if}
              </div>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .tabs { align-self: start; }
  .list { display: grid; gap: 0.7rem; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  @media (max-width: 400px) { .list { grid-template-columns: 1fr; } }
  .loan { display: flex; gap: 0.9rem; padding: 0.9rem; align-items: flex-start; }
  .loan.overdue { border-color: color-mix(in srgb, var(--danger) 60%, transparent); }
  .body { display: grid; gap: 0.25rem; min-width: 0; flex: 1; }
  .body p { margin: 0; }
  .title { color: var(--text); font-weight: 600; }
  .who { font-size: 0.9rem; }
  .due { color: var(--muted); }
  .overdue .due { color: var(--danger); font-weight: 600; }
  .note { white-space: pre-wrap; }
  .acts { margin-top: 0.4rem; gap: 0.4rem; }
  .small { font-size: 0.85rem; }
  button.small { padding: 0.4em 0.8em; }
  .grow { flex: 1; }
</style>
