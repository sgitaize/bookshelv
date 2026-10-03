<script lang="ts">
  import { api } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { t, fmtDate, type Key } from '../lib/i18n.svelte.ts';

  type Inst = { id: number; url: string; name: string | null; status: 'linked' | 'pending_out' | 'pending_in'; linkedAt: string | null; reviews: number; queued: number };
  let data = $state<{ url: string | null; name: string; urlFromEnv: boolean; instances: Inst[] } | null>(null);
  let name = $state('');
  let url = $state('');
  let target = $state('');
  let busy = $state(false);

  async function load() {
    try {
      data = await api.get('/admin/federation');
      name = data!.name;
      url = data!.url ?? location.origin;
    } catch (e) { toastError(e); }
  }
  $effect(() => { load(); });

  async function saveSelf(e: SubmitEvent) {
    e.preventDefault();
    try {
      await api.patch('/admin/federation', data?.urlFromEnv ? { name } : { name, url });
      toast(t('common.saved'));
      await load();
    } catch (err) { toastError(err); }
  }

  async function link(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const r = await api.post<{ status: string }>('/admin/federation/link', { url: target });
      toast(r.status === 'linked' ? t('fed.nowLinked') : t('fed.requested'));
      target = '';
      await load();
    } catch (err) { toastError(err); } finally { busy = false; }
  }

  async function accept(i: Inst) {
    try { await api.post(`/admin/federation/${i.id}/accept`); await load(); } catch (e) { toastError(e); }
  }

  async function unlink(i: Inst) {
    if (!confirm(t('fed.unlinkQ', { name: i.name ?? i.url }))) return;
    try { await api.del(`/admin/federation/${i.id}`); await load(); } catch (e) { toastError(e); }
  }
</script>

<div class="card stack">
  <h2>{t('fed.title')}</h2>
  <p class="muted small">{t('fed.info')}</p>
  {#if data}
    <form class="stack self" onsubmit={saveSelf}>
      <div class="row">
        <label class="field grow"><span>{t('fed.name')}</span><input bind:value={name} maxlength="80" /></label>
        <label class="field grow"><span>{t('fed.url')}{#if data.urlFromEnv} ({t('fed.urlEnv')}){/if}</span>
          <input bind:value={url} disabled={data.urlFromEnv} />
        </label>
      </div>
      <button class="small" style="justify-self: start">{t('common.save')}</button>
    </form>

    <form class="row" onsubmit={link}>
      <input bind:value={target} placeholder={t('fed.linkPh')} class="grow" required />
      <button class="primary" disabled={busy}>{t('fed.link')}</button>
    </form>

    {#each data.instances as i (i.id)}
      <div class="inst">
        <div class="grow">
          <strong>{i.name ?? i.url}</strong> <span class="muted small">{i.url}</span>
          <div class="small">
            <span class="chip" class:accent={i.status === 'linked'}>{t(`fed.${i.status}` as Key)}</span>
            {#if i.status === 'linked'}<span class="muted"> · {fmtDate(i.linkedAt)} · {t('fed.stats', { r: i.reviews, q: i.queued })}</span>{/if}
          </div>
        </div>
        {#if i.status === 'pending_in'}<button class="small primary" onclick={() => accept(i)}>{t('fed.accept')}</button>{/if}
        <button class="small ghost danger" onclick={() => unlink(i)}>{i.status === 'pending_in' ? t('fed.decline') : t('fed.unlink')}</button>
      </div>
    {:else}
      <p class="muted small">{t('fed.none')}</p>
    {/each}
  {/if}
</div>

<style>
  .grow { flex: 1; min-width: 12rem; }
  .row { align-items: flex-end; }
  .inst { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; padding: 0.7rem 0; border-top: 1px solid var(--line); }
  button.small { padding: 0.4em 0.8em; font-size: 0.85rem; }
</style>
