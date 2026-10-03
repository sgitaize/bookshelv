<script lang="ts">
  import { api } from '../lib/api.ts';
  import { loadSession, session } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, tn, i18n, fmtDate } from '../lib/i18n.svelte.ts';

  // login | setup (erster Admin) | register (per Einladungslink)
  let { mode, inviteToken = '' }: { mode: 'login' | 'setup' | 'register'; inviteToken?: string } = $props();

  let username = $state('');
  let displayName = $state('');
  let password = $state('');
  let password2 = $state('');
  let setupToken = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let invite = $state<{ valid: boolean; invitedBy?: string } | null>(null);

  $effect(() => {
    if (mode === 'register') api.get<typeof invite>(`/invites/check/${encodeURIComponent(inviteToken)}`).then(r => (invite = r));
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (mode !== 'login' && password !== password2) return (error = t('auth.pwMismatch'));
    busy = true;
    try {
      if (mode === 'login') await api.post('/login', { username, password });
      else if (mode === 'setup') await api.post('/setup', { token: setupToken.trim(), username, displayName, password });
      else await api.post('/register', { token: inviteToken, username, displayName, password });
      await loadSession();
      router.go('/', true);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<main class="auth">
  <div class="hero">
    <div class="books" aria-hidden="true">
      {#each [[38, '#e8a54b'], [52, '#c8553d'], [44, '#33777c'], [60, '#e9e4d8'], [36, '#5fb0b3'], [48, '#e8a54b'], [56, '#c8553d']] as [h, c], i}
        <span style="height: {h}px; background: {c}; --i: {i}"></span>
      {/each}
    </div>
    <h1>bookshelv</h1>
    <p class="muted">{t('auth.tagline')}</p>
  </div>

  <form class="card stack" onsubmit={submit}>
    {#if mode === 'setup'}
      <h2>{t('auth.setup')}</h2>
      <p class="muted small">{t('auth.setupInfo')} <code>data/setup-token.txt</code>.</p>
      <label class="field"><span>Setup-Token</span><input bind:value={setupToken} required autocomplete="off" /></label>
    {:else if mode === 'register'}
      {#if invite === null}
        <div class="spinner"></div>
      {:else if !invite.valid}
        <h2>{t('auth.inviteInvalid')}</h2>
        <p class="muted">{t('auth.inviteInvalidText')}</p>
        <a href="/" class="btn">{t('auth.toLogin')}</a>
      {:else}
        <h2>{t('auth.welcome')}</h2>
        <p class="muted small">{t('auth.invitedBy', { n: invite.invitedBy ?? '' })}</p>
      {/if}
    {:else}
      <h2>{t('auth.signIn')}</h2>
    {/if}

    {#if mode !== 'register' || invite?.valid}
      <label class="field"><span>{t('auth.username')}</span>
        <input bind:value={username} required autocomplete="username" autocapitalize="off" spellcheck="false" minlength="3" maxlength="32" pattern="[a-zA-Z0-9._\-]+" />
      </label>
      {#if mode !== 'login'}
        <label class="field"><span>{t('auth.displayName')}</span><input bind:value={displayName} maxlength="60" placeholder={t('auth.displayNamePh')} /></label>
      {/if}
      <label class="field"><span>{t('auth.password')}</span>
        <input type="password" bind:value={password} required minlength={mode === 'login' ? 1 : 8} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
      </label>
      {#if mode !== 'login'}
        <label class="field"><span>{t('auth.password2')}</span><input type="password" bind:value={password2} required minlength="8" autocomplete="new-password" /></label>
      {/if}
      {#if error}<p class="err">{error}</p>{/if}
      <button class="primary" disabled={busy}>
        {mode === 'login' ? t('auth.signIn') : mode === 'setup' ? t('auth.createAdmin') : t('auth.createAccount')}
      </button>
      {#if mode === 'login' && !session.needsSetup}
        <p class="muted small center">{t('auth.noAccount')}</p>
      {/if}
    {/if}
  </form>

  <footer class="muted small">
    <a href="https://github.com/sgitaize/bookshelv" target="_blank" rel="noopener">bookshelv</a> – {t('auth.footer')}
    · <a href="https://sgitaize.aize-it.de" target="_blank" rel="noopener">sgitaize</a>
    · <a href="/legal#impressum">{t('privacy.imprint')}</a> · <a href="/legal#datenschutz">{t('privacy.title')}</a>
    · <button class="lang" onclick={() => i18n.set(i18n.lang === 'de' ? 'en' : 'de')}>{i18n.lang === 'de' ? 'English' : 'Deutsch'}</button>
  </footer>
</main>

<style>
  .auth {
    min-height: 100dvh;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 2rem;
    padding: 2rem 1.2rem;
  }
  .hero { text-align: center; max-width: 420px; }
  .hero h1 { font-size: 3rem; margin-bottom: 0.3rem; }
  .books { display: flex; gap: 4px; justify-content: center; align-items: flex-end; height: 64px; margin-bottom: 1rem; }
  .books span {
    width: 14px;
    border-radius: 2px 2px 1px 1px;
    box-shadow: inset -3px 0 0 rgb(0 0 0 / 0.18), inset 0 6px 0 rgb(255 255 255 / 0.12);
    animation: rise 0.6s cubic-bezier(.2,.9,.3,1.3) backwards;
    animation-delay: calc(var(--i) * 60ms);
  }
  .books span:nth-child(4) { rotate: 8deg; transform-origin: bottom left; }
  @keyframes rise { from { transform: translateY(30px); opacity: 0; } }
  form { width: min(400px, 100%); }
  footer { text-align: center; }
  .lang { padding: 0; border: none; background: none; color: var(--accent); font-size: inherit; font-weight: 500; }
  .lang:hover { background: none; text-decoration: underline; }
  .err { color: var(--danger); margin: 0; font-size: 0.9rem; }
  .center { text-align: center; margin: 0; }
  code { font-size: 0.85em; background: var(--surface-2); padding: 0.1em 0.35em; border-radius: 5px; }
</style>
