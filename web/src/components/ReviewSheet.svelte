<script lang="ts">
  import { QueuedError } from '../lib/offline.svelte.ts';
  import { api, visibilityLabel, MOODS, PACES, type Mood, type Pace, type BookReviews, type Review, type Visibility } from '../lib/api.ts';
  import { session, toast, toastError } from '../lib/state.svelte.ts';
  import Sheet from './Sheet.svelte';
  import Stars from './Stars.svelte';
  import { t, i18n } from '../lib/i18n.svelte.ts';

  let { open, bookId, title, existing, onclose, onsaved }: {
    open: boolean; bookId: number; title: string; existing: Review | null;
    onclose: () => void; onsaved: (r: BookReviews) => void;
  } = $props();

  let rating = $state<number | null>(null);
  let text = $state('');
  let visibility = $state<Visibility>('instance');
  let spoiler = $state(false);
  let moods = $state<Mood[]>([]);
  let pace = $state<Pace | null>(null);
  const toggleMood = (m: Mood) => (moods = moods.includes(m) ? moods.filter(x => x !== m) : [...moods, m]);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    rating = existing?.rating ?? null;
    text = existing?.text ?? '';
    visibility = existing?.visibility ?? session.me?.prefs?.reviewVisibility ?? 'instance';
    spoiler = existing?.spoiler ?? false;
    moods = existing?.moods ?? [];
    pace = existing?.pace ?? null;
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (rating === null && !text.trim() && !moods.length && !pace) return toastError(t('review.needInput'));
    busy = true;
    try {
      onsaved(await api.put<BookReviews>(`/books/${bookId}/review`, { rating, text, visibility, spoiler, moods, pace }));
      toast(t('review.saved'));
      onclose();
    } catch (err) {
      toastError(err);
      if (err instanceof QueuedError) onclose();
    } finally { busy = false; }
  }

  async function remove() {
    if (!confirm(t('review.deleteQ'))) return;
    try {
      onsaved(await api.del<BookReviews>(`/books/${bookId}/review`));
      onclose();
    } catch (err) { toastError(err); }
  }
</script>

<Sheet {open} {onclose} title={t('review.rate')}>
  <form class="stack" onsubmit={save}>
    <p class="muted small book">{title}</p>
    <div class="rate">
      <Stars value={rating} size={38} onchange={v => (rating = v)} />
      <span class="num">{rating ? `${rating.toLocaleString(i18n.locale)} / 5` : t('review.tapStars')}</span>
    </div>
    <label class="field">
      <span>{t('review.opinion')}</span>
      <textarea bind:value={text} rows="6" maxlength="10000" placeholder={t('review.opinionPh')}></textarea>
    </label>
    <div class="field">
      <span>{t('review.moods')}</span>
      <div class="chips">
        {#each MOODS as m}<button type="button" class:active={moods.includes(m)} aria-pressed={moods.includes(m)} onclick={() => toggleMood(m)}>{t(`mood.${m}`)}</button>{/each}
      </div>
    </div>
    <div class="field">
      <span>{t('review.pace')}</span>
      <div class="chips">
        {#each PACES as p}<button type="button" class:active={pace === p} aria-pressed={pace === p} onclick={() => (pace = pace === p ? null : p)}>{t(`pace.${p}`)}</button>{/each}
      </div>
    </div>
    <label class="row check"><input type="checkbox" bind:checked={spoiler} /> {t('review.spoiler')}</label>
    <label class="field">
      <span>{t('review.whoSees')}</span>
      <select bind:value={visibility}>
        <option value="instance">{visibilityLabel.instance}</option>
        <option value="private">{visibilityLabel.private}</option>
        <option value="federated">{visibilityLabel.federated}</option>
      </select>
    </label>
    <div class="row">
      <button class="primary grow" disabled={busy}>{t('common.save')}</button>
      {#if existing}<button type="button" class="ghost danger" onclick={remove}>{t('common.delete')}</button>{/if}
    </div>
  </form>
</Sheet>

<style>
  .book { margin: 0; font-weight: 500; }
  .rate { display: grid; justify-items: center; gap: 0.3rem; padding: 0.5rem 0; }
  .num { font-size: 0.9rem; color: var(--muted); }
  .check { font-weight: 500; cursor: pointer; font-size: 0.92rem; }
  .grow { flex: 1; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chips button { font-size: 0.8rem; padding: 0.3em 0.75em; border-radius: 999px; white-space: normal; }
  .chips button.active { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
</style>
