<script lang="ts">
  import { api, labels, type CopyValues, type Store } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t, tn, i18n, fmtDate } from '../lib/i18n.svelte.ts';

  let { value = $bindable(), showStatus = true }: { value: CopyValues; showStatus?: boolean } = $props();

  let stores = $state<Store[]>([]);
  let adding = $state(false);
  let newStore = $state('');
  $effect(() => {
    if (value.format !== 'print' && !stores.length) api.get<Store[]>('/stores').then(r => (stores = r)).catch(toastError);
  });

  function pickStore(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    if (v === 'new') { adding = true; return; }
    value.storeId = v ? Number(v) : null;
  }

  const setDur = (h: number, m: number) => (value.durationMin = h * 60 + m || null);

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
      {#each ['print', 'ebook', 'audio'] as const as f}
        <button type="button" class:active={value.format === f} onclick={() => (value.format = f)}>{labels.format[f]}</button>
      {/each}
    </div>
  </div>

  {#if value.format === 'audio'}
    <div class="group">
      <span class="lbl">{t('copy.duration')}</span>
      <div class="row dur">
        <input type="number" inputmode="numeric" min="0" max="166" aria-label={t('copy.hours')} value={value.durationMin ? Math.floor(value.durationMin / 60) : ''}
          oninput={e => setDur(Number((e.target as HTMLInputElement).value) || 0, (value.durationMin ?? 0) % 60)} />
        <span class="muted small">{t('copy.hours')}</span>
        <input type="number" inputmode="numeric" min="0" max="59" aria-label={t('copy.minutes')} value={value.durationMin ? value.durationMin % 60 : ''}
          oninput={e => setDur(Math.floor((value.durationMin ?? 0) / 60), Number((e.target as HTMLInputElement).value) || 0)} />
        <span class="muted small">{t('copy.minutes')}</span>
      </div>
    </div>
  {/if}

  {#if value.format !== 'print'}
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
  {#if value.readStatus === 'read'}
    <!-- „gelesen am“ gleich beim Eintragen; leer = Datum unbekannt -->
    {#if value.finishedAt !== ''}
      <label class="field readon"><span>{t('dates.finishedOn')}</span>
        <input type="date" value={value.finishedAt ?? new Date().toISOString().slice(0, 10)} max={new Date().toISOString().slice(0, 10)}
          oninput={e => (value.finishedAt = (e.target as HTMLInputElement).value || '')} />
      </label>
    {/if}
    <label class="check"><input type="checkbox" checked={value.finishedAt === ''}
      onchange={e => (value.finishedAt = (e.target as HTMLInputElement).checked ? '' : undefined)} /> {t('dates.unknown')}</label>
  {/if}
  {/if}

  <label class="field">
    <span>{t('copy.note')}</span>
    <textarea bind:value={value.notes} rows="2" maxlength="2000" placeholder={t('copy.notePh')}></textarea>
  </label>
</div>

<style>
  .check { display: inline-flex; gap: 0.5em; align-items: center; cursor: pointer; font-size: 0.92rem; }
  .form { gap: 0.9rem; }
  .group { display: grid; gap: 0.35rem; justify-items: start; }
  .group.wide { justify-items: stretch; }
  .add { flex-wrap: nowrap; }
  .add input { flex: 1; }
  .lbl { font-size: 0.82rem; color: var(--muted); font-weight: 500; }
  .toggle { display: flex; align-items: center; gap: 0.55rem; cursor: pointer; font-weight: 500; }
  .toggle input { width: 18px; height: 18px; }
  .dur { align-items: center; gap: 0.4rem; }
  .dur input { width: 5rem; }
</style>
