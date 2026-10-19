<script lang="ts">
  // Admin: bei neuen Meldungen benachrichtigt werden – Web Push auf diesem Gerät oder über ntfy/Pushover/Telegram
  // (geht auch in der App); dazu die Zugangsdaten der Instanz für Pushover (App-Token) und Telegram (Bot-Token)
  import { api } from '../lib/api.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { inApp } from '../lib/app.svelte.ts';
  import { pushSupported, pushSubscription, enablePush, disablePush } from '../lib/push.ts';
  import PushChannels from './PushChannels.svelte';

  type State = { pushover: boolean; pushoverFromEnv?: boolean; telegram: boolean; telegramFromEnv?: boolean; telegramBot: string | null };
  let st = $state<State | null>(null);
  let pushover = $state('');
  let telegram = $state('');
  let busy = $state(false);
  $effect(() => { api.get<State>('/admin/push').then(r => (st = r)).catch(toastError); });

  let pushOn = $state(false);
  let pushBusy = $state(false);
  // Kanalliste neu laden, wenn Pushover/Telegram hier eingerichtet oder entfernt werden
  let channelsKey = $state(0);
  $effect(() => { pushSubscription().then(sub => (pushOn = !!sub)); });
  async function togglePush() {
    pushBusy = true;
    try {
      if (pushOn) { await disablePush(); pushOn = false; }
      else if (await enablePush()) { pushOn = true; toast(t('push.on')); }
      else toastError(t('push.denied'));
    } catch (e) { toastError(e); } finally { pushBusy = false; }
  }

  async function save(patch: Record<string, string>) {
    busy = true;
    try {
      st = { ...st!, ...(await api.patch<State>('/admin/push', patch)) };
      pushover = ''; telegram = '';
      channelsKey++;
      toast(t('admin.saved'));
    } catch (e) { toastError(e); } finally { busy = false; }
  }
</script>

{#if st}
  <div class="card stack">
    <h2>{t('push.title')}</h2>
    <p class="muted small">{t('push.info')}</p>
    {#if pushSupported()}
      <label class="row check"><input type="checkbox" checked={pushOn} disabled={pushBusy} onchange={togglePush} /> <span class="grow">{t('push.toggle')}</span></label>
    {:else}
      <p class="muted small">{t(inApp() ? 'push.inApp' : 'push.unsupported')}</p>
    {/if}
    {#key channelsKey}<PushChannels />{/key}
    <h3>{t('admin.pushTitle')}</h3>
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
  h3 { margin: 0.6rem 0 0; font-size: 0.95rem; }
  .check { font-weight: 500; cursor: pointer; }
  .row { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1 1 12rem; min-width: 0; }
</style>
