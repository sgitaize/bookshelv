<script lang="ts">
  import { api, inviteUrl, type Invite } from '../lib/api.ts';
  import { session, loadSession, toast, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import Icon from '../components/Icon.svelte';

  let displayName = $state(session.me!.displayName);
  let shelfVisible = $state(session.me!.shelfVisible);
  let invites = $state<Invite[]>([]);
  let note = $state('');
  let pw = $state({ current: '', next: '', next2: '' });
  let deletePw = $state('');

  const loadInvites = () => api.get<Invite[]>('/invites').then(r => (invites = r)).catch(toastError);
  $effect(() => { loadInvites(); });

  async function saveProfile(e: SubmitEvent) {
    e.preventDefault();
    try {
      await api.patch('/me', { displayName, shelfVisible });
      await loadSession();
      toast('Profil gespeichert');
    } catch (err) { toastError(err); }
  }

  async function createInvite() {
    try {
      const r = await api.post<{ token: string }>('/invites', { note: note || null });
      note = '';
      await loadInvites();
      share(r.token);
    } catch (e) { toastError(e); }
  }

  async function share(token: string) {
    const url = inviteUrl(token);
    if (navigator.share) {
      try { await navigator.share({ title: 'Einladung zu bookshelv', text: 'Komm in meine Bücherrunde:', url }); return; }
      catch { /* abgebrochen → kopieren */ }
    }
    await navigator.clipboard.writeText(url);
    toast('Link kopiert');
  }

  async function revoke(i: Invite) {
    try { await api.del(`/invites/${i.id}`); await loadInvites(); } catch (e) { toastError(e); }
  }

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    if (pw.next !== pw.next2) return toastError('Neue Passwörter stimmen nicht überein');
    try {
      await api.post('/me/password', { current: pw.current, password: pw.next });
      pw = { current: '', next: '', next2: '' };
      toast('Passwort geändert – andere Geräte wurden abgemeldet');
    } catch (err) { toastError(err); }
  }

  async function logout() {
    await api.post('/logout');
    session.me = null;
    router.go('/', true);
  }

  async function deleteAccount(e: SubmitEvent) {
    e.preventDefault();
    if (!confirm('Konto, Regal, Reviews und alle deine Daten endgültig löschen?')) return;
    try {
      await api.del('/me', { password: deletePw });
      session.me = null;
      router.go('/', true);
    } catch (err) { toastError(err); }
  }

  const fmt = (d: string) => new Date(d.replace(' ', 'T') + (d.endsWith('Z') ? '' : 'Z')).toLocaleDateString('de-DE');
</script>

<section class="stack">
  <div class="spread">
    <h1>Profil</h1>
    <button onclick={logout}><Icon name="logout" size={16} /> Abmelden</button>
  </div>

  <form class="card stack" onsubmit={saveProfile}>
    <h2>Über dich</h2>
    <p class="muted small">Angemeldet als <strong>@{session.me?.username}</strong></p>
    <label class="field"><span>Anzeigename</span><input bind:value={displayName} maxlength="60" required /></label>
    <label class="row check"><input type="checkbox" bind:checked={shelfVisible} /> Andere dürfen mein Regal sehen</label>
    <button class="primary">Speichern</button>
  </form>

  <div class="card stack" id="invites">
    <h2>Freunde einladen</h2>
    <p class="muted small">Ein Link gilt 14 Tage und für genau eine Person.</p>
    <div class="row">
      <input bind:value={note} placeholder="Für wen? (optional, nur für dich)" maxlength="100" class="grow" />
      <button class="primary" onclick={createInvite}><Icon name="link" size={16} /> Link erstellen</button>
    </div>
    {#if invites.length}
      <ul class="invites">
        {#each invites as i (i.id)}
          <li>
            <span class="grow">
              <strong>{i.note ?? 'Einladung'}</strong>
              <span class="muted small">
                {#if i.usedBy}angenommen von {i.usedBy}
                {:else if new Date(i.expiresAt) < new Date()}abgelaufen
                {:else}offen bis {fmt(i.expiresAt)}{/if}
              </span>
            </span>
            {#if !i.usedBy && new Date(i.expiresAt) > new Date()}
              <button class="icon ghost" onclick={() => share(i.token)} aria-label="Teilen"><Icon name="copy" size={18} /></button>
              <button class="icon ghost danger" onclick={() => revoke(i)} aria-label="Zurückziehen"><Icon name="x" size={18} /></button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <form class="card stack" onsubmit={changePassword}>
    <h2>Passwort ändern</h2>
    <input type="text" autocomplete="username" value={session.me?.username} hidden />
    <label class="field"><span>Aktuelles Passwort</span><input type="password" bind:value={pw.current} required autocomplete="current-password" /></label>
    <label class="field"><span>Neues Passwort</span><input type="password" bind:value={pw.next} required minlength="8" autocomplete="new-password" /></label>
    <label class="field"><span>Wiederholen</span><input type="password" bind:value={pw.next2} required minlength="8" autocomplete="new-password" /></label>
    <button>Passwort ändern</button>
  </form>

  <div class="card stack">
    <h2>Deine Daten</h2>
    <p class="muted small">bookshelv speichert nur, was du selbst einträgst. Keine E-Mail, kein Tracking, keine externen Dienste im Browser.</p>
    <a class="btn" href="/api/me/export" download><Icon name="download" size={16} /> Alle Daten exportieren (JSON)</a>
    <details>
      <summary class="danger-text">Konto löschen …</summary>
      <form class="stack del" onsubmit={deleteAccount}>
        <p class="muted small">Löscht dein Konto mit Regal, Reviews, Kommentaren und Verleih-Einträgen endgültig.</p>
        <input type="password" bind:value={deletePw} placeholder="Passwort zur Bestätigung" required autocomplete="current-password" />
        <button class="danger">Endgültig löschen</button>
      </form>
    </details>
  </div>
</section>

<style>
  section { max-width: 640px; }
  .check { font-weight: 500; cursor: pointer; }
  .grow { flex: 1; min-width: 0; }
  .invites { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
  .invites li { display: flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0; border-top: 1px solid var(--line); }
  .invites .grow { display: grid; }
  .danger-text { color: var(--danger); cursor: pointer; font-weight: 550; }
  .del { margin-top: 0.8rem; }
</style>
