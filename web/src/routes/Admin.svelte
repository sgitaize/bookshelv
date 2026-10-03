<script lang="ts">
  import { api, inviteUrl, type Invite } from '../lib/api.ts';
  import { session, toast, toastError } from '../lib/state.svelte.ts';
  import Icon from '../components/Icon.svelte';
  import FederationAdmin from '../components/FederationAdmin.svelte';
  import { t, tn, i18n, fmtDate } from '../lib/i18n.svelte.ts';

  type Stats = { users: number; books: number; copies: number; reviews: number; openLoans: number; orphanBooks: number; dbBytes: number; coverBytes: number; version: string; node: string };
  type AdminUser = { id: number; username: string; displayName: string; isAdmin: boolean; disabled: boolean; createdAt: string; invitedBy: string | null; copies: number; lastLogin: string | null; hasAvatar: boolean };

  let stats = $state<Stats | null>(null);
  let users = $state<AdminUser[]>([]);
  let invites = $state<Invite[]>([]);
  let resetFor = $state<{ name: string; password: string } | null>(null);

  async function load() {
    try {
      [stats, users, invites] = await Promise.all([
        api.get<Stats>('/admin/stats'), api.get<AdminUser[]>('/admin/users'), api.get<Invite[]>('/admin/invites')
      ]);
    } catch (e) { toastError(e); }
  }
  $effect(() => { load(); });

  async function patch(u: AdminUser, body: Partial<{ isAdmin: boolean; disabled: boolean }>) {
    try { await api.patch(`/admin/users/${u.id}`, body); await load(); } catch (e) { toastError(e); }
  }

  async function reset(u: AdminUser) {
    if (!confirm(t('admin.resetQ', { n: u.displayName }))) return;
    try {
      const r = await api.post<{ password: string }>(`/admin/users/${u.id}/reset-password`);
      resetFor = { name: u.displayName, password: r.password };
    } catch (e) { toastError(e); }
  }

  async function remove(u: AdminUser) {
    if (!confirm(t('admin.deleteQ', { n: u.displayName }))) return;
    try { await api.del(`/admin/users/${u.id}`); toast(t('common.deleted')); await load(); } catch (e) { toastError(e); }
  }

  async function revoke(i: Invite) {
    try { await api.del(`/invites/${i.id}`); await load(); } catch (e) { toastError(e); }
  }

  async function invite() {
    try {
      const r = await api.post<{ token: string }>('/invites', {});
      await navigator.clipboard.writeText(inviteUrl(r.token)).catch(() => {});
      toast(t('admin.inviteCopied'));
      await load();
    } catch (e) { toastError(e); }
  }

  async function cleanup() {
    if (!confirm(t('admin.cleanupQ'))) return;
    try {
      const r = await api.post<{ books: number; invites: number }>('/admin/cleanup');
      toast(t('admin.cleaned', { b: r.books, i: r.invites }));
      await load();
    } catch (e) { toastError(e); }
  }

  let refreshing = $state(false);
  async function refreshGenres() {
    refreshing = true;
    try {
      const r = await api.post<{ books: number; updated: number }>('/admin/refresh-genres');
      toast(t('admin.genresDone', { n: r.updated, total: r.books }));
    } catch (e) { toastError(e); } finally { refreshing = false; }
  }

  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
  const date = (d: string | null) => d ? fmtDate(d) : '–';
</script>

<section class="stack">
  <div class="spread">
    <h1>Admin</h1>
    <button class="primary" onclick={invite}><Icon name="link" size={16} /> {t('admin.createInvite')}</button>
  </div>

  {#if stats}
    <div class="stats">
      <div class="card"><b>{stats.users}</b><span>{t('admin.users')}</span></div>
      <div class="card"><b>{stats.copies}</b><span>{t('admin.copies')}</span></div>
      <div class="card"><b>{stats.books}</b><span>{t('admin.catalog')}</span></div>
      <div class="card"><b>{stats.openLoans}</b><span>{t('admin.openLoans')}</span></div>
      <div class="card"><b>{mb(stats.dbBytes + stats.coverBytes)}</b><span>{t('admin.storage', { db: mb(stats.dbBytes) })}</span></div>
    </div>
    <div class="card spread">
      <span class="muted small">{t('admin.orphans', { n: stats.orphanBooks })} · bookshelv {stats.version} · Node {stats.node}</span>
      <button onclick={cleanup}><Icon name="trash" size={16} /> {t('admin.cleanup')}</button>
      <button onclick={refreshGenres} disabled={refreshing}><Icon name="sparkle" size={16} /> {refreshing ? t('admin.genresBusy') : t('admin.genres')}</button>
    </div>
  {/if}

  <div class="card">
    <h2>{t('admin.users')}</h2>
    <div class="table">
      {#each users as u (u.id)}
        <div class="urow" class:dis={u.disabled}>
          <div class="who">
            <strong>{u.displayName}</strong> <span class="muted small">@{u.username}</span>
            {#if u.isAdmin}<span class="chip accent">Admin</span>{/if}
            {#if u.disabled}<span class="chip">{t('admin.blocked')}</span>{/if}
            <div class="muted small">{tn('n.books', u.copies)} · {t('admin.since', { d: date(u.createdAt) })}{#if u.invitedBy} · {t('admin.invitedBy', { n: u.invitedBy })}{/if} · {t('admin.lastSeen', { d: date(u.lastLogin) })}</div>
          </div>
          {#if u.id !== session.me?.id}
            <div class="row acts">
              <button class="small" onclick={() => patch(u, { isAdmin: !u.isAdmin })}>{u.isAdmin ? t('admin.revokeAdmin') : t('admin.makeAdmin')}</button>
              <button class="small" onclick={() => patch(u, { disabled: !u.disabled })}>{u.disabled ? t('admin.unblock') : t('admin.block')}</button>
              {#if u.hasAvatar}<button class="small" onclick={() => api.del(`/admin/users/${u.id}/avatar`).then(load).catch(toastError)}>{t('avatar.adminRemove')}</button>{/if}
              <button class="small" onclick={() => reset(u)}>{t('admin.resetPw')}</button>
              <button class="small danger" onclick={() => remove(u)}>{t('common.delete')}</button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <FederationAdmin />

  <div class="card">
    <h2>{t('admin.invites')}</h2>
    <div class="table">
      {#each invites as i (i.id)}
        <div class="urow">
          <div class="who">
            <strong>{i.createdBy}</strong> {#if i.note}<span class="muted">– {i.note}</span>{/if}
            <div class="muted small">
              {t('admin.created', { d: date(i.createdAt) })} ·
              {#if i.usedBy}{t('invite.acceptedBy', { n: i.usedBy })}{:else if new Date(i.expiresAt) < new Date()}{t('invite.expired')}{:else}{t('invite.openUntil', { d: date(i.expiresAt) })}{/if}
            </div>
          </div>
          {#if !i.usedBy}<button class="small danger" onclick={() => revoke(i)}>{t('common.delete')}</button>{/if}
        </div>
      {:else}
        <p class="muted">{t('admin.noInvites')}</p>
      {/each}
    </div>
  </div>
</section>

{#if resetFor}
  <div class="pwbox card">
    <p>{t('admin.newPw', { n: resetFor.name })}</p>
    <code>{resetFor.password}</code>
    <div class="row">
      <button onclick={() => navigator.clipboard.writeText(resetFor!.password).then(() => toast(t('common.copied')))}>{t('common.copy')}</button>
      <button class="primary" onclick={() => (resetFor = null)}>{t('common.done')}</button>
    </div>
  </div>
{/if}

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.7rem; }
  .stats .card { display: grid; padding: 1rem; }
  .stats b { font-size: 1.7rem; }
  .stats span { color: var(--muted); font-size: 0.82rem; }
  .table { display: grid; }
  .urow { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; padding: 0.8rem 0; border-top: 1px solid var(--line); }
  .urow.dis { opacity: 0.6; }
  .acts button.small, button.small { padding: 0.4em 0.8em; font-size: 0.82rem; }
  .pwbox { position: fixed; z-index: 60; left: 50%; top: 50%; translate: -50% -50%; width: min(420px, 92vw); display: grid; gap: 0.8rem; }
  .pwbox code { font-size: 1.4rem; background: var(--surface-2); padding: 0.6rem; border-radius: 8px; text-align: center; user-select: all; }
</style>
