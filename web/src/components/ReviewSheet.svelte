<script lang="ts">
  import { api, visibilityLabel, type BookReviews, type Review, type Visibility } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import Sheet from './Sheet.svelte';
  import Stars from './Stars.svelte';

  let { open, bookId, title, existing, onclose, onsaved }: {
    open: boolean; bookId: number; title: string; existing: Review | null;
    onclose: () => void; onsaved: (r: BookReviews) => void;
  } = $props();

  let rating = $state<number | null>(null);
  let text = $state('');
  let visibility = $state<Visibility>('instance');
  let spoiler = $state(false);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    rating = existing?.rating ?? null;
    text = existing?.text ?? '';
    visibility = existing?.visibility ?? 'instance';
    spoiler = existing?.spoiler ?? false;
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (rating === null && !text.trim()) return toastError('Gib Sterne oder einen Text ein');
    busy = true;
    try {
      onsaved(await api.put<BookReviews>(`/books/${bookId}/review`, { rating, text, visibility, spoiler }));
      toast('Bewertung gespeichert');
      onclose();
    } catch (err) { toastError(err); } finally { busy = false; }
  }

  async function remove() {
    if (!confirm('Bewertung samt Kommentaren löschen?')) return;
    try {
      onsaved(await api.del<BookReviews>(`/books/${bookId}/review`));
      onclose();
    } catch (err) { toastError(err); }
  }
</script>

<Sheet {open} {onclose} title="Bewerten">
  <form class="stack" onsubmit={save}>
    <p class="muted small book">{title}</p>
    <div class="rate">
      <Stars value={rating} size={38} onchange={v => (rating = v)} />
      <span class="num">{rating ? `${rating.toLocaleString('de-DE')} / 5` : 'Tippe auf die Sterne'}</span>
    </div>
    <label class="field">
      <span>Deine Meinung (optional)</span>
      <textarea bind:value={text} rows="6" maxlength="10000" placeholder="Was hat dir gefallen, was nicht?"></textarea>
    </label>
    <label class="row check"><input type="checkbox" bind:checked={spoiler} /> Enthält Spoiler (Text wird verdeckt)</label>
    <label class="field">
      <span>Wer darf das sehen?</span>
      <select bind:value={visibility}>
        <option value="instance">{visibilityLabel.instance}</option>
        <option value="private">{visibilityLabel.private}</option>
        <option value="federated">{visibilityLabel.federated} (sobald verfügbar)</option>
      </select>
    </label>
    <div class="row">
      <button class="primary grow" disabled={busy}>Speichern</button>
      {#if existing}<button type="button" class="ghost danger" onclick={remove}>Löschen</button>{/if}
    </div>
  </form>
</Sheet>

<style>
  .book { margin: 0; font-weight: 500; }
  .rate { display: grid; justify-items: center; gap: 0.3rem; padding: 0.5rem 0; }
  .num { font-size: 0.9rem; color: var(--muted); }
  .check { font-weight: 500; cursor: pointer; font-size: 0.92rem; }
  .grow { flex: 1; }
</style>
