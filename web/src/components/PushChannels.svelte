<script lang="ts">
  // Push über andere Apps (ntfy, Pushover, Telegram) – geht auch in der iOS-/Android-App, wo es kein Web Push gibt
  import { api } from '../lib/api.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import Icon from './Icon.svelte';

  type Kind = 'ntfy' | 'pushover' | 'telegram';
  type Channel = { kind: Kind; target: string | null; pending: boolean; lastOk: string | null };
  let data = $state<{ available: { ntfy: boolean; pushover: boolean; telegram: string | null }; channels: Channel[] } | null>(null);
  let ntfyUrl = $state('');
  let pushoverKey = $state('');
  let telegramUrl = $state<string | null>(null);
  let busy = $state(false);

  const load = () => api.get<typeof data>('/push/channels').then(r => (data = r)).catch(() => {});
  $effect(() => { load(); });
  const ch = (k: Kind) => data?.channels.find(c => c.kind === k && !c.pending) ?? null;
  const setChannels = (list: Channel[]) => { if (data) data.channels = list; };

  /** zufälliges, schwer zu erratendes Thema (ntfy-Themen sind öffentlich) */
  function randomTopic() {
    const a = crypto.getRandomValues(new Uint8Array(9));
    ntfyUrl = `https://ntfy.sh/bookshelv-${[...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
  }

  async function run(fn: () => Promise<void>) {
    busy = true;
    try { await fn(); } catch (e) { toastError(e); } finally { busy = false; }
  }
  const saveNtfy = () => run(async () => { setChannels(await api.put<Channel[]>('/push/channels/ntfy', { url: ntfyUrl })); ntfyUrl = ''; toast(t('pushx.saved')); });
  const savePushover = () => run(async () => { setChannels(await api.put<Channel[]>('/push/channels/pushover', { key: pushoverKey })); pushoverKey = ''; toast(t('pushx.saved')); });
  const remove = (k: Kind) => run(async () => { setChannels(await api.del<Channel[]>(`/push/channels/${k}`)); if (k === 'telegram') telegramUrl = null; });
  const linkTelegram = () => run(async () => { telegramUrl = (await api.post<{ url: string }>('/push/channels/telegram')).url; });
  const checkTelegram = () => run(async () => {
    if ((await api.post<{ linked: boolean }>('/push/channels/telegram/check')).linked) { telegramUrl = null; await load(); toast(t('pushx.tgLinked')); }
    else toastError(t('pushx.tgNotYet'));
  });
  const test = () => run(async () => {
    const r = await api.post<{ results: { kind: Kind; ok: boolean }[] }>('/push/test');
    const bad = r.results.filter(x => !x.ok).map(x => x.kind);
    if (bad.length) toastError(t('pushx.testFailed', { k: bad.join(', ') })); else toast(t('pushx.testSent'));
  });
</script>

{#if data}
  <div class="stack chans">
    <h4>{t('pushx.title')}</h4>
    <p class="muted small">{t('pushx.info')}</p>

    <div class="chan">
      <strong>ntfy</strong>
      {#if ch('ntfy')}
        <span class="row"><code>{ch('ntfy')!.target}</code><button class="small ghost" onclick={() => remove('ntfy')} disabled={busy}>{t('common.remove')}</button></span>
      {:else}
        <p class="muted small">{t('pushx.ntfyInfo')}</p>
        <form class="row" onsubmit={e => { e.preventDefault(); saveNtfy(); }}>
          <input class="grow" bind:value={ntfyUrl} placeholder="https://ntfy.sh/…" inputmode="url" autocomplete="off" />
          <button type="button" class="small ghost" onclick={randomTopic}>{t('pushx.random')}</button>
          <button class="small primary" disabled={busy || !ntfyUrl}>{t('common.save')}</button>
        </form>
      {/if}
    </div>

    {#if data.available.pushover}
      <div class="chan">
        <strong>Pushover</strong>
        {#if ch('pushover')}
          <span class="row"><code>{ch('pushover')!.target}</code><button class="small ghost" onclick={() => remove('pushover')} disabled={busy}>{t('common.remove')}</button></span>
        {:else}
          <p class="muted small">{t('pushx.pushoverInfo')}</p>
          <form class="row" onsubmit={e => { e.preventDefault(); savePushover(); }}>
            <input class="grow" bind:value={pushoverKey} placeholder={t('pushx.pushoverKey')} maxlength="30" autocomplete="off" />
            <button class="small primary" disabled={busy || pushoverKey.length !== 30}>{t('common.save')}</button>
          </form>
        {/if}
      </div>
    {/if}

    {#if data.available.telegram}
      <div class="chan">
        <strong>Telegram</strong>
        {#if ch('telegram')}
          <span class="row"><span class="muted small">{t('pushx.tgOn', { bot: data.available.telegram })}</span><button class="small ghost" onclick={() => remove('telegram')} disabled={busy}>{t('common.remove')}</button></span>
        {:else if telegramUrl}
          <p class="muted small">{t('pushx.tgStep')}</p>
          <span class="row">
            <a class="btn small primary" href={telegramUrl} target="_blank" rel="noopener">{t('pushx.tgOpen', { bot: data.available.telegram })}</a>
            <button class="small" onclick={checkTelegram} disabled={busy}>{t('pushx.tgCheck')}</button>
          </span>
        {:else}
          <p class="muted small">{t('pushx.tgInfo', { bot: data.available.telegram })}</p>
          <button class="small" onclick={linkTelegram} disabled={busy}>{t('pushx.tgConnect')}</button>
        {/if}
      </div>
    {/if}

    {#if data.channels.some(c => !c.pending)}
      <button class="small ghost test" onclick={test} disabled={busy}><Icon name="bell" size={14} /> {t('pushx.test')}</button>
    {/if}
  </div>
{/if}

<style>
  h4 { margin: 0.4rem 0 0; font-size: 0.95rem; }
  .chans { border-top: 1px solid var(--line); padding-top: 0.8rem; }
  .chan { display: grid; gap: 0.35rem; }
  .chan p { margin: 0; }
  .row { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1 1 12rem; min-width: 0; }
  code { font-size: 0.8rem; overflow-wrap: anywhere; background: var(--surface-2); padding: 0.2rem 0.4rem; border-radius: 6px; }
  .test { justify-self: start; }
</style>
