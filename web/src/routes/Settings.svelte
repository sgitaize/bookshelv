<script lang="ts">
  import { forgetMe } from '../lib/offline.svelte.ts';
  import { api, inviteUrl, type Invite } from '../lib/api.ts';
  import { session, loadSession, toast, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import Icon from '../components/Icon.svelte';
  import { t, tn, i18n, fmtDate, type Key } from '../lib/i18n.svelte.ts';
  import { getTheme, getFont, setPrefs, THEMES, SWATCH, type Theme, type Font, type Prefs } from '../lib/theme.ts';
  import Avatar from '../components/Avatar.svelte';

  let displayName = $state(session.me!.displayName);
  let shelfVisible = $state(session.me!.shelfVisible);
  let invites = $state<Invite[]>([]);
  let note = $state('');
  let pw = $state({ current: '', next: '', next2: '' });
  let deletePw = $state('');
  let theme = $state<Theme>(getTheme());
  let font = $state<Font>(getFont());
  /** sofort anwenden, am Konto speichern (dann gilt es auch auf anderen Geräten) */
  async function choose(p: Prefs) {
    if (p.theme) theme = p.theme;
    if (p.font) font = p.font;
    setPrefs(p);
    try { await api.patch('/me', { prefs: p }); if (session.me) session.me.prefs = { ...session.me.prefs, ...p }; } catch (e) { toastError(e); }
  }
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
    forgetMe();
    session.me = null;
    router.go('/', true);
  }

  async function deleteAccount(e: SubmitEvent) {
    e.preventDefault();
    if (!confirm(t('settings.deleteQ'))) return;
    try {
      await api.del('/me', { password: deletePw });
      forgetMe();
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
    <div class="handle">
      <span class="muted small">{t('fed.myHandle')}</span>
      <code>@{session.me?.username}@{location.host}</code>
      <span class="muted small">{t('fed.myHandleInfo')}</span>
    </div>
    <label class="row check"><input type="checkbox" bind:checked={shelfVisible} /> {t('settings.shelfVisible')}</label>
    <button class="primary">{t('common.save')}</button>
  </form>

  <div class="card stack">
    <h2>{t('settings.appearance')}</h2>
    <div class="themes" role="radiogroup" aria-label={t('settings.theme')}>
      {#each THEMES as th (th)}
        {@const sw = th === 'system' ? null : SWATCH[th]}
        <button class="theme" class:active={theme === th} role="radio" aria-checked={theme === th} onclick={() => choose({ theme: th })}>
          <span class="sw" style={sw ? `--a: ${sw[0]}; --b: ${sw[1]}; --c: ${sw[2]}` : `--a: ${SWATCH.light[0]}; --b: ${SWATCH.night[0]}; --c: ${SWATCH.night[2]}`} class:split={!sw}>
            <span class="bar"></span><span class="dotc"></span>
          </span>
          <span>{t(`theme.${th}` as Key)}</span>
        </button>
      {/each}
    </div>
    <h2>{t('settings.font')}</h2>
    <div class="segmented">
      <button class:active={font === 'typewriter'} onclick={() => choose({ font: 'typewriter' })} style="font-family: 'Courier Prime', monospace">{t('font.typewriter')}</button>
      <button class:active={font === 'modern'} onclick={() => choose({ font: 'modern' })} style="font-family: Poppins, sans-serif">{t('font.modern')}</button>
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
    <a class="btn" href="/import"><Icon name="download" size={16} /> {t('imp.link')}</a>
    <a class="btn ghost" href="/imports"><Icon name="book" size={16} /> {t('imp.history')}</a>
    <div class="exports">
      <span class="muted small">{t('exp.title')}</span>
      <a class="btn" href="/api/me/export.csv?format=goodreads" download><Icon name="upload" size={16} /> {t('exp.goodreads')}</a>
      <a class="btn" href="/api/me/export.csv?format=storygraph" download><Icon name="upload" size={16} /> {t('exp.storygraph')}</a>
      <a class="btn" href="/api/me/export.csv?format=simple" download><Icon name="upload" size={16} /> {t('exp.simple')}</a>
      <a class="btn" href="/api/me/export" download><Icon name="download" size={16} /> {t('settings.export')}</a>
      <span class="muted small">{t('exp.info')}</span>
    </div>
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
  .handle { display: grid; gap: 0.2rem; }
  .handle code { font-size: 0.95rem; background: var(--surface-2); padding: 0.4rem 0.6rem; border-radius: 8px; justify-self: start; user-select: all; overflow-wrap: anywhere; }
  label.btn { cursor: pointer; }
  label.btn.disabled { opacity: 0.5; pointer-events: none; }
  .about { text-align: center; margin-top: 1rem; }
  .exports { display: grid; gap: 0.5rem; justify-items: start; }
  .exports .btn { max-width: 100%; white-space: normal; text-align: left; }
  .themes { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
  .theme { display: grid; grid-template-columns: 1fr; justify-content: stretch; gap: 0.35rem; justify-items: stretch; padding: 0.45rem; border-radius: 12px; font-size: 0.85rem; white-space: normal; }
  .theme.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  /* Mini-Vorschau: Hintergrund, Fläche als Balken, Akzent als Punkt */
  .sw { position: relative; height: 44px; border-radius: 8px; background: var(--a); border: 1px solid rgb(127 127 127 / 0.25); overflow: hidden; }
  .sw.split { background: linear-gradient(135deg, var(--a) 50%, var(--b) 50%); }
  .sw .bar { position: absolute; left: 8px; right: 22px; top: 10px; height: 9px; border-radius: 4px; background: var(--b); }
  .sw.split .bar { display: none; }
  .sw .dotc { position: absolute; right: 8px; bottom: 8px; width: 14px; height: 14px; border-radius: 50%; background: var(--c); }
</style>
