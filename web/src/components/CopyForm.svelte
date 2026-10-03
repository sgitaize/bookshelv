<script lang="ts">
  import { labels, type CopyValues } from '../lib/api.ts';

  let { value = $bindable(), showStatus = true }: { value: CopyValues; showStatus?: boolean } = $props();
</script>

<div class="stack form">
  <div class="group">
    <span class="lbl">Format</span>
    <div class="segmented">
      {#each ['print', 'ebook'] as const as f}
        <button type="button" class:active={value.format === f} onclick={() => (value.format = f)}>{labels.format[f]}</button>
      {/each}
    </div>
  </div>

  {#if value.format === 'print'}
    <div class="group">
      <span class="lbl">Bindung</span>
      <div class="segmented">
        {#each ['paperback', 'hardcover'] as const as b}
          <button type="button" class:active={value.binding === b}
            onclick={() => (value.binding = value.binding === b ? null : b)}>{labels.binding[b]}</button>
        {/each}
      </div>
    </div>
    <label class="toggle">
      <input type="checkbox" bind:checked={value.sprayedEdges} />
      <span>Farbschnitt</span>
      {#if value.sprayedEdges}<span class="chip edge">✦</span>{/if}
    </label>
  {/if}

  {#if showStatus}
  <div class="group">
    <span class="lbl">Status</span>
    <div class="segmented">
      {#each ['unread', 'reading', 'read'] as const as r}
        <button type="button" class:active={value.readStatus === r} onclick={() => (value.readStatus = r)}>{labels.read[r]}</button>
      {/each}
    </div>
  </div>
  {/if}

  <label class="field">
    <span>Notiz (nur für dich)</span>
    <textarea bind:value={value.notes} rows="2" maxlength="2000" placeholder="z. B. signiert, Geschenk von …"></textarea>
  </label>
</div>

<style>
  .form { gap: 0.9rem; }
  .group { display: grid; gap: 0.35rem; justify-items: start; }
  .lbl { font-size: 0.82rem; color: var(--muted); font-weight: 500; }
  .toggle { display: flex; align-items: center; gap: 0.55rem; cursor: pointer; font-weight: 500; }
  .toggle input { width: 18px; height: 18px; }
</style>
