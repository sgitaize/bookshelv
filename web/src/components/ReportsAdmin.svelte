<script lang="ts">
  // Admin: offene Meldungen mit Auszug, Link zum Inhalt und Aktionen (erledigt, Inhalt löschen, Konto sperren)
  import { api } from '../lib/api.ts';
  import { toast, toastError, pollNotifications } from '../lib/state.svelte.ts';
  import { t, tn, fmtDate, type Key } from '../lib/i18n.svelte.ts';
  import Icon from './Icon.svelte';

  type Person = { id: number; displayName: string; username: string; disabled: boolean } | null;
  type Report = {
    id: number; type: 'review' | 'comment' | 'user' | 'post'; reason: string; note: string | null; excerpt: string | null; createdAt: string;
    resolvedAt: string | null; resolution: string | null; reporter: Person; target: Person; count: number; href: string; exists: boolean;
  };
  let data = $state<{ open: number; items: Report[] } | null>(null);
  let all = $state(false);
  const load = () => api.get<{ open: number; items: Report[] }>(`/admin/reports${all ? '?all=1' : ''}`).then(r => (data = r)).catch(toastError);
  $effect(() => { void all; load(); });

  async function resolve(r: Report, action: 'dismiss' | 'remove' | 'disable') {
    if (action !== 'dismiss' && !confirm(t(action === 'remove' ? 'mod.admin.removeQ' : 'mod.admin.disableQ', { name: r.target?.displayName ?? '–' }))) return;
    try {
      await api.post(`/admin/reports/${r.id}/resolve`, { action });
      toast(t('admin.saved'));
      await load();
      pollNotifications(true);
    } catch (e) { toastError(e); }
  }
</script>

<div class="card stack" id="reports">
  <div class="spread">
    <h2>{t('mod.admin.title')}{#if data?.open} <span class="chip accent">{data.open}</span>{/if}</h2>
    <label class="row check small"><input type="checkbox" bind:checked={all} /> {t('mod.admin.showDone')}</label>
  </div>
  {#if data && !data.items.length}<p class="muted small">{t('mod.admin.none')}</p>{/if}
  {#each data?.items ?? [] as r (r.id)}
    <div class="rep" class:done={!!r.resolvedAt}>
      <div class="muted small">
        {t(`mod.type.${r.type}` as Key)} · {t(`mod.reason.${r.reason}` as Key)} · {fmtDate(r.createdAt)}
        {#if r.count > 1} · {tn('mod.admin.times', r.count)}{/if}
        {#if r.reporter} · {t('mod.admin.by', { name: r.reporter.displayName })}{/if}
      </div>
      <div><strong>{r.target?.displayName ?? '–'}</strong>{#if r.target} <span class="muted small">@{r.target.username}</span>{/if}{#if r.target?.disabled} <span class="chip">{t('admin.blocked')}</span>{/if}</div>
      {#if r.excerpt}<blockquote>{r.excerpt}</blockquote>{/if}
      {#if r.note}<p class="small"><b>{t('mod.note')}:</b> {r.note}</p>{/if}
      {#if r.resolvedAt}
        <p class="muted small">{t(`mod.admin.res.${r.resolution}` as Key)} · {fmtDate(r.resolvedAt)}</p>
      {:else}
        <div class="row acts">
          {#if r.exists && r.href}<a class="btn small" href={r.href}><Icon name="arrow" size={14} /> {t('mod.admin.open')}</a>{/if}
          <button class="small" onclick={() => resolve(r, 'dismiss')}><Icon name="check" size={14} /> {t('mod.admin.dismiss')}</button>
          {#if r.exists}<button class="small" onclick={() => resolve(r, 'remove')}><Icon name="trash" size={14} /> {t(r.type === 'user' ? 'mod.admin.removeAvatar' : 'mod.admin.remove')}</button>{/if}
          {#if r.target && !r.target.disabled}<button class="small danger" onclick={() => resolve(r, 'disable')}><Icon name="ban" size={14} /> {t('mod.admin.disable')}</button>{/if}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  h2 { margin: 0; }
  .check { font-weight: 500; cursor: pointer; }
  .rep { display: grid; gap: 0.35rem; padding: 0.8rem 0; border-top: 1px solid var(--line); }
  .rep.done { opacity: 0.65; }
  blockquote { margin: 0; padding: 0.4rem 0.7rem; border-left: 3px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.9rem; max-height: 9rem; overflow: auto; }
  .acts { flex-wrap: wrap; gap: 0.4rem; }
  .small { font-size: 0.82rem; }
  button.small, .btn.small { padding: 0.4em 0.8em; }
</style>
