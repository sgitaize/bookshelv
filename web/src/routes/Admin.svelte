<script lang="ts">
  import { api, inviteUrl, type Invite } from '../lib/api.ts';
  import { session, toast, toastError } from '../lib/state.svelte.ts';
  import Icon from '../components/Icon.svelte';

  type Stats = { users: number; books: number; copies: number; reviews: number; openLoans: number; orphanBooks: number; dbBytes: number; coverBytes: number; version: string; node: string };
  type AdminUser = { id: number; username: string; displayName: string; isAdmin: boolean; disabled: boolean; createdAt: string; invitedBy: string | null; copies: number; lastLogin: string | null };

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
    if (!confirm(`Neues Passwort für ${u.displayName} erzeugen? Alle Sitzungen werden beendet.`)) return;
    try {
      const r = await api.post<{ password: string }>(`/admin/users/${u.id}/reset-password`);
      resetFor = { name: u.displayName, password: r.password };
    } catch (e) { toastError(e); }
  }

  async function remove(u: AdminUser) {
    if (!confirm(`${u.displayName} mit allen Daten endgültig löschen?`)) return;
    try { await api.del(`/admin/users/${u.id}`); toast('Gelöscht'); await load(); } catch (e) { toastError(e); }
  }

  async function revoke(i: Invite) {
    try { await api.del(`/invites/${i.id}`); await load(); } catch (e) { toastError(e); }
  }

  async function invite() {
    try {
      const r = await api.post<{ token: string }>('/invites', {});
      await navigator.clipboard.writeText(inviteUrl(r.token)).catch(() => {});
      toast('Einladungslink erstellt und kopiert');
      await load();
    } catch (e) { toastError(e); }
  }

  async function cleanup() {
    if (!confirm('Bücher ohne Exemplar/Review, abgelaufene Einladungen und den Vorschau-Cache löschen?')) return;
    try {
      const r = await api.post<{ books: number; invites: number }>('/admin/cleanup');
      toast(`${r.books} Bücher und ${r.invites} Einladungen entfernt`);
      await load();
    } catch (e) { toastError(e); }
  }

  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
  const date = (d: string | null) => d ? new Date(d.replace(' ', 'T') + (d.endsWith('Z') ? '' : 'Z')).toLocaleDateString('de-DE') : '–';
</script>

<section class="stack">
  <div class="spread">
    <h1>Admin</h1>
    <button class="primary" onclick={invite}><Icon name="link" size={16} /> Einladung erstellen</button>
  </div>

  {#if stats}
    <div class="stats">
      <div class="card"><b>{stats.users}</b><span>Nutzer</span></div>
      <div class="card"><b>{stats.copies}</b><span>Exemplare</span></div>
      <div class="card"><b>{stats.books}</b><span>Katalog-Einträge</span></div>
      <div class="card"><b>{stats.openLoans}</b><span>offene Verleihe</span></div>
      <div class="card"><b>{mb(stats.dbBytes + stats.coverBytes)}</b><span>Speicher (DB {mb(stats.dbBytes)})</span></div>
    </div>
    <div class="card spread">
      <span class="muted small">{stats.orphanBooks} Katalog-Einträge ohne Exemplar · bookshelv {stats.version} · Node {stats.node}</span>
      <button onclick={cleanup}><Icon name="trash" size={16} /> Aufräumen</button>
    </div>
  {/if}

  <div class="card">
    <h2>Nutzer</h2>
    <div class="table">
      {#each users as u (u.id)}
        <div class="urow" class:dis={u.disabled}>
          <div class="who">
            <strong>{u.displayName}</strong> <span class="muted small">@{u.username}</span>
            {#if u.isAdmin}<span class="chip accent">Admin</span>{/if}
            {#if u.disabled}<span class="chip">gesperrt</span>{/if}
            <div class="muted small">{u.copies} Bücher · seit {date(u.createdAt)}{#if u.invitedBy} · eingeladen von {u.invitedBy}{/if} · zuletzt {date(u.lastLogin)}</div>
          </div>
          {#if u.id !== session.me?.id}
            <div class="row acts">
              <button class="small" onclick={() => patch(u, { isAdmin: !u.isAdmin })}>{u.isAdmin ? 'Admin entziehen' : 'Zum Admin'}</button>
              <button class="small" onclick={() => patch(u, { disabled: !u.disabled })}>{u.disabled ? 'Entsperren' : 'Sperren'}</button>
              <button class="small" onclick={() => reset(u)}>Passwort zurücksetzen</button>
              <button class="small danger" onclick={() => remove(u)}>Löschen</button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <div class="card">
    <h2>Einladungen</h2>
    <div class="table">
      {#each invites as i (i.id)}
        <div class="urow">
          <div class="who">
            <strong>{i.createdBy}</strong> {#if i.note}<span class="muted">– {i.note}</span>{/if}
            <div class="muted small">
              erstellt {date(i.createdAt)} ·
              {#if i.usedBy}angenommen von {i.usedBy}{:else if new Date(i.expiresAt) < new Date()}abgelaufen{:else}offen bis {date(i.expiresAt)}{/if}
            </div>
          </div>
          {#if !i.usedBy}<button class="small danger" onclick={() => revoke(i)}>Löschen</button>{/if}
        </div>
      {:else}
        <p class="muted">Keine Einladungen.</p>
      {/each}
    </div>
  </div>
</section>

{#if resetFor}
  <div class="pwbox card">
    <p>Neues Passwort für <strong>{resetFor.name}</strong> – gib es persönlich weiter, es wird nicht noch einmal angezeigt:</p>
    <code>{resetFor.password}</code>
    <div class="row">
      <button onclick={() => navigator.clipboard.writeText(resetFor!.password).then(() => toast('Kopiert'))}>Kopieren</button>
      <button class="primary" onclick={() => (resetFor = null)}>Fertig</button>
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
