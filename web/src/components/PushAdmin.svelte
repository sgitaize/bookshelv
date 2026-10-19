<script lang="ts">
  // Admin: Zugangsdaten für Pushover (App-Token) und Telegram (Bot-Token); ntfy braucht nichts
  import { api } from '../lib/api.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';

  type State = { pushover: boolean; pushoverFromEnv?: boolean; telegram: boolean; telegramFromEnv?: boolean; telegramBot: string | null };
  let st = $state<State | null>(null);
  let pushover = $state('');
  let telegram = $state('');
  let busy = $state(false);
  $effect(() => { api.get<State>('/admin/push').then(r => (st = r)).catch(toastError); });

  async function save(patch: Record<string, string>) {
    busy = true;
    try {
      st = { ...st!, ...(await api.patch<State>('/admin/push', patch)) };
      pushover = ''; telegram = '';
      toast(t('admin.saved'));
    } catch (e) { toastError(e); } finally { busy = false; }
  }
</script>

{#if st}
  <div class="card stack">
    <h2>{t('admin.pushTitle')}</h2>
    <p class="muted small">{t('admin.pushInfo')}</p>
    <label class="field"><span>{t('admin.pushoverToken')}{#if st.pushover} · {st.pushoverFromEnv ? t('admin.tokenEnv') : t('admin.tokenSet')}{/if}</span>
      {#if !st.pushoverFromEnv}
        <div class="row">
          <input class="grow" type="password" bind:value={pushover} maxlength="30" autocomplete="off" placeholder={st.pushover ? '••••••' : ''} />
          <button class="small" disabled={busy || !pushover} onclick={() => save({ pushoverToken: pushover })}>{t('common.save')}</button>
          {#if st.pushover}<button class="small ghost danger" disabled={busy} onclick={() => save({ pushoverToken: '' })}>{t('common.remove')}</button>{/if}
        </div>
      {/if}
    </label>
    <label class="field"><span>{t('admin.telegramToken')}{#if st.telegram} · {st.telegramFromEnv ? t('admin.tokenEnv') : t('admin.tokenSet')}{#if st.telegramBot} (@{st.telegramBot}){/if}{/if}</span>
      {#if !st.telegramFromEnv}
        <div class="row">
          <input class="grow" type="password" bind:value={telegram} autocomplete="off" placeholder={st.telegram ? '••••••' : '123456:ABC…'} />
          <button class="small" disabled={busy || !telegram} onclick={() => save({ telegramToken: telegram })}>{t('common.save')}</button>
          {#if st.telegram}<button class="small ghost danger" disabled={busy} onclick={() => save({ telegramToken: '' })}>{t('common.remove')}</button>{/if}
        </div>
      {/if}
    </label>
  </div>
{/if}

<style>
  h2 { margin: 0; }
  .row { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1 1 12rem; min-width: 0; }
</style>
