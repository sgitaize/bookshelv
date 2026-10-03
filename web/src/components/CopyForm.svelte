<script lang="ts">
  import { api, labels, type CopyValues, type Store } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t, tn, i18n, fmtDate } from '../lib/i18n.svelte.ts';

  let { value = $bindable(), showStatus = true }: { value: CopyValues; showStatus?: boolean } = $props();

  let stores = $state<Store[]>([]);
  let adding = $state(false);
  let newStore = $state('');
  $effect(() => {
    if (value.format === 'ebook' && !stores.length) api.get<Store[]>('/stores').then(r => (stores = r)).catch(toastError);
  });

  function pickStore(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    if (v === 'new') { adding = true; return; }
    value.storeId = v ? Number(v) : null;
  }

  async function createStore() {
    const name = newStore.trim();
    if (!name) return;
    try {
      const s = await api.post<Store>('/stores', { name });
      if (!stores.some(x => x.id === s.id)) stores = [...stores, s].sort((a, b) => a.name.localeCompare(b.name));
      value.storeId = s.id;
      adding = false;
      newStore = '';
    } catch (err) { toastError(err); }
  }
</script>

<div class="stack form">
  <div class="group">
    <span class="lbl">{t('copy.format')}</span>
    <div class="segmented">
      {#each ['print', 'ebook'] as const as f}
        <button type="button" class:active={value.format === f} onclick={() => (value.format = f)}>{labels.format[f]}</button>
      {/each}
    </div>
  </div>

  {#if value.format === 'ebook'}
    <div class="group wide">
      <span class="lbl">{t('copy.store')}</span>
      {#if adding}
        <div class="row add">
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={newStore} maxlength="60" placeholder={t('copy.storeNamePh')} autofocus
            onkeydown={e => { if (e.key === 'Enter') { e.preventDefault(); createStore(); } }} />
          <button type="button" class="primary" onclick={createStore}>{t('copy.storeAdd')}</button>
          <button type="button" class="ghost" onclick={() => (adding = false)}>{t('common.cancel')}</button>
        </div>
      {:else}
        <select value={value.storeId ?? ''} onchange={pickStore}>
          <option value="">{t('copy.storeNone')}</option>
          {#each stores as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
          <option value="new">{t('copy.storeNew')}</option>
        </select>
      {/if}
    </div>
  {/if}

  {#if value.format === 'print'}
    <div class="group">
      <span class="lbl">{t('copy.binding')}</span>
      <div class="segmented">
        {#each ['paperback', 'hardcover'] as const as b}
          <button type="button" class:active={value.binding === b}
            onclick={() => (value.binding = value.binding === b ? null : b)}>{labels.binding[b]}</button>
        {/each}
      </div>
    </div>
    <label class="toggle">
      <input type="checkbox" bind:checked={value.sprayedEdges} />
      <span>{t('copy.edges')}</span>
      {#if value.sprayedEdges}<span class="chip edge">✦</span>{/if}
    </label>
  {/if}

  {#if showStatus}
  <div class="group">
    <span class="lbl">{t('copy.status')}</span>
    <div class="segmented">
      {#each ['unread', 'reading', 'read'] as const as r}
        <button type="button" class:active={value.readStatus === r} onclick={() => (value.readStatus = r)}>{labels.read[r]}</button>
      {/each}
    </div>
  </div>
  {/if}

  <label class="field">
    <span>{t('copy.note')}</span>
    <textarea bind:value={value.notes} rows="2" maxlength="2000" placeholder={t('copy.notePh')}></textarea>
  </label>
</div>

<style>
  .form { gap: 0.9rem; }
  .group { display: grid; gap: 0.35rem; justify-items: start; }
  .group.wide { justify-items: stretch; }
  .add { flex-wrap: nowrap; }
  .add input { flex: 1; }
  .lbl { font-size: 0.82rem; color: var(--muted); font-weight: 500; }
  .toggle { display: flex; align-items: center; gap: 0.55rem; cursor: pointer; font-weight: 500; }
  .toggle input { width: 18px; height: 18px; }
</style>
