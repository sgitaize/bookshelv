<script lang="ts">
  import { api, percent, type BookBrief, type ReadStatus } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import Sheet from './Sheet.svelte';
  import Cover from './Cover.svelte';

  // Fortschritt eintragen: Seite oder Prozent, oder direkt "fertig"
  let { item, onclose, onsaved }: {
    item: { book: BookBrief; progress: number | null; status: ReadStatus } | null;
    onclose: () => void; onsaved: () => void;
  } = $props();

  let mode = $state<'pages' | 'percent'>('pages');
  let value = $state('');
  let busy = $state(false);

  $effect(() => {
    if (!item) return;
    mode = item.book.pages ? 'pages' : 'percent';
    value = item.progress ? String(item.progress) : '';
  });

  async function save(status?: ReadStatus) {
    if (!item) return;
    busy = true;
    try {
      const n = Number(value);
      // Prozent ohne bekannte Seitenzahl: als Seiten von 100 speichern
      const progress = status ? undefined : mode === 'percent' && item.book.pages ? Math.round((n / 100) * item.book.pages) : n;
      await api.put(`/books/${item.book.id}/reading`, status ? { status } : { progress });
      toast(status === 'read' ? `„${item.book.title}" fertig gelesen 🎉` : 'Fortschritt gespeichert');
      onsaved();
      onclose();
    } catch (e) { toastError(e); } finally { busy = false; }
  }
</script>

<Sheet open={!!item} {onclose} title="Fortschritt">
  {#if item}
    <div class="head">
      <Cover url={item.book.coverUrl} title={item.book.title} size="sm" />
      <div>
        <strong>{item.book.title}</strong>
        <p class="muted small">{item.book.pages ? `${item.book.pages} Seiten · ` : ''}{percent(item.progress, item.book.pages)}% gelesen</p>
      </div>
    </div>
    <form class="stack" onsubmit={e => { e.preventDefault(); save(); }}>
      {#if item.book.pages}
        <div class="segmented">
          <button type="button" class:active={mode === 'pages'} onclick={() => (mode = 'pages')}>Seite</button>
          <button type="button" class:active={mode === 'percent'} onclick={() => (mode = 'percent')}>Prozent</button>
        </div>
      {/if}
      <label class="field">
        <span>{mode === 'pages' ? `Ich bin auf Seite … von ${item.book.pages}` : 'Prozent gelesen'}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value inputmode="numeric" type="number" min="0" max={mode === 'pages' ? item.book.pages : 100} required autofocus />
      </label>
      <div class="row">
        <button class="primary grow" disabled={busy}>Speichern</button>
        <button type="button" class="dark" onclick={() => save('read')} disabled={busy}>Fertig gelesen</button>
      </div>
    </form>
  {/if}
</Sheet>

<style>
  .head { display: flex; gap: 0.9rem; align-items: center; margin-bottom: 1rem; }
  .head p { margin: 0; }
  .grow { flex: 1; }
  .segmented { align-self: start; }
</style>
