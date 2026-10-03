<script lang="ts">
  import { api, inviteUrl, type Invite } from '../lib/api.ts';
  import { session, loadSession, toast, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import Icon from '../components/Icon.svelte';
  import { t, tn, i18n, fmtDate } from '../lib/i18n.svelte.ts';
  import { getTheme, setTheme, type Theme } from '../lib/theme.ts';
  import Avatar from '../components/Avatar.svelte';

  let displayName = $state(session.me!.displayName);
  let shelfVisible = $state(session.me!.shelfVisible);
  let invites = $state<Invite[]>([]);
  let note = $state('');
  let pw = $state({ current: '', next: '', next2: '' });
  let deletePw = $state('');
  let theme = $state<Theme>(getTheme());
  let uploading = $state(false);

  /** Bild im Browser quadratisch zuschneiden und auf 256 px verkleinern – hochgeladen werden nur ein paar KB */
  async function pickAvatar(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    uploading = true;
    try {
      const img = await createImageBitmap(file);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
      let data = canvas.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.85); // ältere Safari
      await api.post('/me/avatar', { image: data });
      await loadSession();
      toast(t('avatar.saved'));
    } catch (err) { toastError(err); } finally { uploading = false; }
  }

  async function removeAvatar() {
    try { await api.del('/me/avatar'); await loadSession(); } catch (err) { toastError(err); }
  }

  const loadInvites = () => api.get<Invite[]>('/invites').then(r => (invites = r)).catch(toastError);
  $effect(() => { loadInvites(); });

  async function saveProfile(e: SubmitEvent) {
    e.preventDefault();
    try {
      await api.patch('/me', { displayName, shelfVisible });
      await loadSession();
      toast(t('settings.profileSaved'));
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
      try { await navigator.share({ title: t('invite.shareTitle'), text: t('invite.shareText'), url }); return; }
      catch { /* abgebrochen → kopieren */ }
    }
    await navigator.clipboard.writeText(url);
    toast(t('invite.copied'));
  }

  async function revoke(i: Invite) {
    try { await api.del(`/invites/${i.id}`); await loadInvites(); } catch (e) { toastError(e); }
  }

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    if (pw.next !== pw.next2) return toastError(t('settings.pwMismatch'));
    try {
      await api.post('/me/password', { current: pw.current, password: pw.next });
      pw = { current: '', next: '', next2: '' };
      toast(t('settings.pwChanged'));
    } catch (err) { toastError(err); }
  }

  async function logout() {
    await api.post('/logout');
    session.me = null;
    router.go('/', true);
  }

  async function deleteAccount(e: SubmitEvent) {
    e.preventDefault();
    if (!confirm(t('settings.deleteQ'))) return;
    try {
      await api.del('/me', { password: deletePw });
      session.me = null;
      router.go('/', true);
    } catch (err) { toastError(err); }
  }

  const fmt = (d: string) => fmtDate(d);
</script>

<section class="stack">
  <div class="spread">
    <h1>{t('settings.title')}</h1>
    <button onclick={logout}><Icon name="logout" size={16} /> {t('settings.logout')}</button>
  </div>

  <div class="card stack">
    <h2>{t('avatar.title')}</h2>
    <div class="row avrow">
      <Avatar name={session.me?.displayName ?? '?'} url={session.me?.avatarUrl} size={72} />
      <label class="btn" class:disabled={uploading}>
        {uploading ? '…' : t('avatar.upload')}
        <input type="file" accept="image/*" onchange={pickAvatar} hidden />
      </label>
      {#if session.me?.avatarUrl}<button class="ghost danger" onclick={removeAvatar}>{t('avatar.remove')}</button>{/if}
    </div>
    <p class="muted small">{t('avatar.info')}</p>
  </div>

  <form class="card stack" onsubmit={saveProfile}>
    <h2>{t('settings.about')}</h2>
    <p class="muted small">{t('settings.signedInAs', { u: session.me?.username ?? '' })}</p>
    <label class="field"><span>{t('auth.displayName')}</span><input bind:value={displayName} maxlength="60" required /></label>
    <label class="row check"><input type="checkbox" bind:checked={shelfVisible} /> {t('settings.shelfVisible')}</label>
    <button class="primary">{t('common.save')}</button>
  </form>

  <div class="card stack">
    <h2>{t('settings.appearance')}</h2>
    <div class="segmented">
      {#each [['dark', t('settings.dark')], ['light', t('settings.light')], ['system', t('settings.system')]] as [th, label]}
        <button class:active={theme === th} onclick={() => { theme = th as Theme; setTheme(theme); }}>{label}</button>
      {/each}
    </div>
    <h2>{t('settings.language')}</h2>
    <div class="segmented">
      <button class:active={i18n.lang === 'de'} onclick={() => i18n.set('de')}>Deutsch</button>
      <button class:active={i18n.lang === 'en'} onclick={() => i18n.set('en')}>English</button>
    </div>
  </div>

  <div class="card stack" id="invites">
    <h2>{t('invite.title')}</h2>
    <p class="muted small">{t('invite.info')}</p>
    <div class="row">
      <input bind:value={note} placeholder={t('invite.notePh')} maxlength="100" class="grow" />
      <button class="primary" onclick={createInvite}><Icon name="link" size={16} /> {t('invite.create')}</button>
    </div>
    {#if invites.length}
      <ul class="invites">
        {#each invites as i (i.id)}
          <li>
            <span class="grow">
              <strong>{i.note ?? t('invite.one')}</strong>
              <span class="muted small">
                {#if i.usedBy}{t('invite.acceptedBy', { n: i.usedBy })}
                {:else if new Date(i.expiresAt) < new Date()}{t('invite.expired')}
                {:else}{t('invite.openUntil', { d: fmt(i.expiresAt) })}{/if}
              </span>
            </span>
            {#if !i.usedBy && new Date(i.expiresAt) > new Date()}
              <button class="icon ghost" onclick={() => share(i.token)} aria-label={t('invite.share')}><Icon name="copy" size={18} /></button>
              <button class="icon ghost danger" onclick={() => revoke(i)} aria-label={t('invite.revoke')}><Icon name="x" size={18} /></button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <form class="card stack" onsubmit={changePassword}>
    <h2>{t('settings.changePw')}</h2>
    <input type="text" autocomplete="username" value={session.me?.username} hidden />
    <label class="field"><span>{t('settings.currentPw')}</span><input type="password" bind:value={pw.current} required autocomplete="current-password" /></label>
    <label class="field"><span>{t('settings.newPw')}</span><input type="password" bind:value={pw.next} required minlength="8" autocomplete="new-password" /></label>
    <label class="field"><span>{t('settings.repeat')}</span><input type="password" bind:value={pw.next2} required minlength="8" autocomplete="new-password" /></label>
    <button>{t('settings.changePw')}</button>
  </form>

  <div class="card stack">
    <h2>{t('settings.data')}</h2>
    <p class="muted small">{t('settings.dataInfo')}</p>
    <a class="btn" href="/api/me/export" download><Icon name="download" size={16} /> {t('settings.export')}</a>
    <details>
      <summary class="danger-text">{t('settings.deleteAccount')}</summary>
      <form class="stack del" onsubmit={deleteAccount}>
        <p class="muted small">{t('settings.deleteInfo')}</p>
        <input type="password" bind:value={deletePw} placeholder={t('settings.confirmPw')} required autocomplete="current-password" />
        <button class="danger">{t('settings.deleteForever')}</button>
      </form>
    </details>
  </div>

  <p class="muted small about">
    {t('settings.free')} · <a href="https://github.com/sgitaize/bookshelv" target="_blank" rel="noopener">{t('settings.source')}</a>
    · {t('settings.builtBy')} <a href="https://sgitaize.aize-it.de" target="_blank" rel="noopener">sgitaize</a>
  </p>
</section>

<style>
  section { max-width: 680px; margin: 0 auto; }
  .check { font-weight: 500; cursor: pointer; }
  .grow { flex: 1; min-width: 0; }
  .invites { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
  .invites li { display: flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0; border-top: 1px solid var(--line); }
  .invites .grow { display: grid; }
  .danger-text { color: var(--danger); cursor: pointer; font-weight: 550; }
  .del { margin-top: 0.8rem; }
  .segmented { align-self: start; }
  .avrow { gap: 1rem; }
  label.btn { cursor: pointer; }
  label.btn.disabled { opacity: 0.5; pointer-events: none; }
  .about { text-align: center; margin-top: 1rem; }
</style>
