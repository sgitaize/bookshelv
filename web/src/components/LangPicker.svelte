<script lang="ts">
  // Sprache wählen: Deutsch/Englisch/Spanisch direkt, weitere per Auswahl, „Automatisch“ = erkannte Sprache
  import { t } from '../lib/i18n.svelte.ts';
  import { QUICK_LANGS, MORE_LANGS, langName } from '../lib/lang.ts';

  let { value, auto, onpick, disabled = false }: { value: string | null; auto?: string | null; onpick: (code: string | null) => void; disabled?: boolean } = $props();
  const more = $derived(value && !(QUICK_LANGS as readonly string[]).includes(value) ? value : '');
</script>

<div class="langs">
  <div class="segmented">
    <button class:active={value === null} {disabled} onclick={() => onpick(null)}>{auto !== undefined ? t('lang.auto', { lang: langName(auto) }) : t('lang.autoShort')}</button>
    {#each QUICK_LANGS as code}
      <button class:active={value === code} {disabled} onclick={() => onpick(code)}>{langName(code)}</button>
    {/each}
  </div>
  <select value={more} {disabled} aria-label={t('lang.other')} onchange={e => { const v = (e.target as HTMLSelectElement).value; if (v) onpick(v); }}>
    <option value="">{t('lang.other')}</option>
    {#each MORE_LANGS as code}<option value={code}>{langName(code)}</option>{/each}
  </select>
</div>

<style>
  .langs { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .segmented { flex-wrap: wrap; }
  select { width: auto; }
</style>
