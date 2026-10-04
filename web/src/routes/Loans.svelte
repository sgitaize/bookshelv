<script lang="ts">
  import { api, type Loan, type Loans, type LoanRequest } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, fmtDate, type Key } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';

  type Tab = 'lent' | 'borrowed' | 'history' | 'requests';
  let tab = $state<Tab>((router.query.get('tab') as Tab) ?? 'lent');
  let data = $state<Loans | null>(null);
  let editingDue = $state<number | null>(null);
  let dueValue = $state('');

  const load = () => api.get<Loans>('/loans').then(r => (data = r)).catch(toastError);
  $effect(() => { load(); });

  const list = $derived(data && tab !== 'requests' ? data[tab] : []);
  const reqCount = $derived(data ? data.requests.incoming.length + data.requests.outgoing.filter(r => r.status === 'pending').length : 0);

  // Anfragen: Annehmen mit optionalem Rückgabedatum
  let accepting = $state<number | null>(null);
  let acceptDue = $state('');
  const today = () => new Date().toISOString().slice(0, 10);
  async function accept(r: LoanRequest) {
    try {
      await api.post(`/loan-requests/${r.id}/accept`, { dueAt: acceptDue || null });
      accepting = null;
      toast(t('req.accepted', { name: r.requester.displayName }));
      await load();
    } catch (e) { toastError(e); }
  }
  async function decline(r: LoanRequest) {
    try { await api.post(`/loan-requests/${r.id}/decline`, {}); await load(); } catch (e) { toastError(e); }
  }
  async function withdraw(r: LoanRequest) {
    try { await api.del(`/loan-requests/${r.id}`); await load(); } catch (e) { toastError(e); }
  }

  async function giveBack(l: Loan) {
    try {
      await api.post(l.remoteLoanId ? `/remote-loans/${l.remoteLoanId}/return` : `/loans/${l.id}/return`, {});
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
    <button class:active={tab === 'requests'} onclick={() => (tab = 'requests')}>{t('req.tab', { n: reqCount })}</button>
    <button onclick={() => router.go('/history?types=lent,got_back,borrowed,gave_back')}>{t('loan.tabHistory')} →</button>
  </div>

  {#if !data}
    <div class="spinner"></div>
  {:else if tab === 'requests'}
    {#if !data.requests.incoming.length && !data.requests.outgoing.length}
      <p class="empty">{t('req.none')}</p>
    {/if}
    {#if data.requests.incoming.length}
      <h2>{t('req.incoming')}</h2>
      <div class="list">
        {#each data.requests.incoming as r (r.id)}
          <article class="card loan">
            <a href="/book/{r.book.id}" class="cv"><Cover url={r.book.coverUrl} title={r.book.title} authors={r.book.authors} size="sm" /></a>
            <div class="body">
              <a href="/book/{r.book.id}" class="title">{r.book.title}</a>
              <p class="who">{t('req.wants', { name: r.requester.displayName })} · {fmtDate(r.createdAt)}</p>
              {#if r.message}<p class="muted small note msg">{r.message}</p>{/if}
              {#if r.lentOut}<p class="due small">{t('req.lentOut')}</p>{/if}
              {#if accepting === r.id}
                <label class="small muted" for="due-{r.id}">{t('req.dueOptional')}</label>
                <div class="row">
                  <input id="due-{r.id}" type="date" bind:value={acceptDue} min={today()} class="grow" />
                  <button class="primary" onclick={() => accept(r)}>{t('req.lend')}</button>
                </div>
              {:else}
                <div class="row acts">
                  <button class="primary small" disabled={r.lentOut} onclick={() => { accepting = r.id; acceptDue = ''; }}><Icon name="check" size={16} /> {t('req.accept')}</button>
                  <button class="ghost small" onclick={() => decline(r)}>{t('req.decline')}</button>
                </div>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
    {#if data.requests.outgoing.length}
      <h2>{t('req.outgoing')}</h2>
      <div class="list">
        {#each data.requests.outgoing as r (r.id)}
          <article class="card loan">
            <a href="/book/{r.book.id}" class="cv"><Cover url={r.book.coverUrl} title={r.book.title} authors={r.book.authors} size="sm" /></a>
            <div class="body">
              <a href="/book/{r.book.id}" class="title">{r.book.title}</a>
              <p class="who">{t('req.askedFrom', { name: r.owner.displayName })} · {fmtDate(r.createdAt)}</p>
              <p class="small status {r.status}">{t(`req.status_${r.status}` as Key)}</p>
              {#if r.status === 'pending'}
                <div class="row acts"><button class="ghost small" onclick={() => withdraw(r)}>{t('req.withdraw')}</button></div>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  {:else if !list.length}
    <p class="empty">{tab === 'lent' ? t('loan.noneLent') : tab === 'borrowed' ? t('loan.noneBorrowed') : t('loan.noneHistory')}</p>
  {:else}
    <div class="list">
      {#each list as l (l.id)}
        <article class="card loan" class:overdue={l.overdue}>
          <a href={l.book.id ? `/book/${l.book.id}` : undefined} class="cv"><Cover url={l.book.coverUrl} title={l.book.title} authors={l.book.authors} size="sm" /></a>
          <div class="body">
            <a href={l.book.id ? `/book/${l.book.id}` : undefined} class="title">{l.book.title}</a>
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
  .tabs { align-self: start; max-width: 100%; overflow-x: auto; scrollbar-width: none; flex-wrap: nowrap; }
  .tabs button { flex-shrink: 0; }
  h2 { margin: 0.6rem 0 0; font-size: 1.1rem; }
  .msg { font-style: italic; }
  .status.accepted { color: var(--accent); font-weight: 600; }
  .status.declined { color: var(--muted); }
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
