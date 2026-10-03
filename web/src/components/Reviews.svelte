<script lang="ts">
  import { api, ago, fmtRating, type BookReviews, type Review } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import Stars from './Stars.svelte';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import ReviewSheet from './ReviewSheet.svelte';
  import { t, tn } from '../lib/i18n.svelte.ts';

  // Bewertungsbereich auf der Buchseite; askReview öffnet das Formular (z. B. nach "Gelesen")
  let { bookId, title, askReview = $bindable(false) }: { bookId: number; title: string; askReview?: boolean } = $props();

  let data = $state<BookReviews | null>(null);
  let revealed = $state(new Set<number>());
  let openComments = $state(new Set<number>());
  let drafts = $state<Record<number, string>>({});

  $effect(() => { api.get<BookReviews>(`/books/${bookId}/reviews`).then(r => (data = r)).catch(toastError); });

  const mine = $derived(data?.reviews.find(r => r.mine) ?? null);
  const others = $derived(data?.reviews.filter(r => !r.mine) ?? []);

  function toggle(set: Set<number>, id: number) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  async function comment(r: Review, e: SubmitEvent) {
    e.preventDefault();
    const text = drafts[r.id]?.trim();
    if (!text) return;
    try {
      data = await api.post<BookReviews>(`/reviews/${r.id}/comments`, { text });
      drafts[r.id] = '';
    } catch (err) { toastError(err); }
  }

  async function removeComment(id: number) {
    if (!confirm(t('comment.deleteQ'))) return;
    try { data = await api.del<BookReviews>(`/comments/${id}`); } catch (err) { toastError(err); }
  }
</script>

<section class="stack reviews">
  <div class="spread">
    <h2>{t('review.title')}</h2>
    {#if data?.average}
      <span class="avg"><Stars value={Math.round(data.average * 2) / 2} size={16} /> <b>{fmtRating(data.average)}</b> <span class="muted small">({data.count})</span></span>
    {/if}
  </div>

  {#if data}
    {#if mine}
      {@render reviewCard(mine)}
    {:else}
      <button class="card cta" onclick={() => (askReview = true)}>
        <Stars value={null} size={22} />
        <span>{t('review.cta')} <strong>{t('review.rate')}</strong></span>
      </button>
    {/if}

    {#each others as r (r.id)}
      {@render reviewCard(r)}
    {/each}
    {#if !others.length}<p class="muted small">{t('review.none')}</p>{/if}
  {/if}
</section>

{#snippet reviewCard(r: Review)}
  <article class="card review">
    <header>
      <a class="av" href={r.mine ? '/me' : `/people/${r.user.id}`}><Avatar name={r.user.displayName} url={r.user.avatarUrl} size={36} /></a>
      <div class="who">
        <a href={r.mine ? '/me' : `/people/${r.user.id}`}><strong>{r.mine ? t('review.you') : r.user.displayName}</strong></a>
        <span class="muted small">{ago(r.updatedAt)}{#if r.visibility === 'private'} · {t('review.onlyYou')}{/if}</span>
      </div>
      {#if r.rating}<span class="rating"><Stars value={r.rating} size={15} /> {fmtRating(r.rating)}</span>{/if}
      {#if r.mine}<button class="icon ghost" onclick={() => (askReview = true)} aria-label={t('review.edit')}><Icon name="edit" size={16} /></button>{/if}
    </header>
    {#if r.text}
      {#if r.spoiler && !r.mine && !revealed.has(r.id)}
        <button class="spoiler" onclick={() => (revealed = toggle(revealed, r.id))}>{t('review.reveal')}</button>
      {:else}
        <p class="text">{r.text}</p>
      {/if}
    {/if}
    <footer>
      <button class="ghost small" onclick={() => (openComments = toggle(openComments, r.id))}>
        💬 {r.comments.length ? tn('n.comments', r.comments.length) : t('comment.add')}
      </button>
    </footer>
    {#if openComments.has(r.id)}
      <div class="comments">
        {#each r.comments as c (c.id)}
          <div class="comment">
            <span class="cuser"><Avatar name={c.user.displayName} url={c.user.avatarUrl} size={20} /> <strong>{c.user.displayName}</strong> <span class="muted small">{ago(c.createdAt)}</span></span>
            {#if c.canDelete}<button class="icon ghost del" onclick={() => removeComment(c.id)} aria-label={t('comment.delete')}><Icon name="x" size={14} /></button>{/if}
            <p>{c.text}</p>
          </div>
        {/each}
        <form class="row" onsubmit={e => comment(r, e)}>
          <input bind:value={drafts[r.id]} placeholder={t('comment.write')} maxlength="2000" class="grow" />
          <button class="primary" aria-label={t('common.send')}><Icon name="arrow" size={16} /></button>
        </form>
      </div>
    {/if}
  </article>
{/snippet}

<ReviewSheet open={askReview} {bookId} {title} existing={mine} onclose={() => (askReview = false)} onsaved={r => (data = r)} />

<style>
  .reviews { margin-top: 2rem; }
  .reviews h2 { margin: 0; }
  .avg { display: inline-flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
  .cta { display: flex; align-items: center; gap: 0.8rem; width: 100%; justify-content: flex-start; font-weight: 400; white-space: normal; text-align: left; }
  .cta strong { color: var(--accent); }
  .review { display: grid; gap: 0.6rem; padding: 1rem; }
  header { display: flex; align-items: center; gap: 0.5rem 0.7rem; flex-wrap: wrap; }
  .av { display: inline-flex; }
  .cuser { display: inline-flex; align-items: center; gap: 0.35rem; }
  .who { display: grid; flex: 1 1 8rem; min-width: 0; line-height: 1.3; }
  .who a { color: var(--text); }
  .rating { display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 600; font-size: 0.9rem; }
  .text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .spoiler { justify-content: flex-start; background: var(--surface-2); font-weight: 500; }
  footer { display: flex; }
  footer .small { padding: 0.3em 0.5em; font-size: 0.85rem; color: var(--muted); }
  .comments { display: grid; gap: 0.6rem; border-top: 1px solid var(--line); padding-top: 0.7rem; }
  .comment { position: relative; padding-right: 1.6rem; }
  .comment p { margin: 0.1rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .del { position: absolute; right: 0; top: -0.2rem; padding: 0.25rem; color: var(--muted); }
  .grow { flex: 1; min-width: 0; }
</style>
