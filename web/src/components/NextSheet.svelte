<script lang="ts">
  // „Was lese ich als Nächstes?“ – zufälliges Buch vom eigenen Stapel, optional nach Stimmung, Tempo und Länge
  import { api, MOODS, PACES, type BookBrief, type Mood, type Pace } from '../lib/api.ts';
  import { t, tn } from '../lib/i18n.svelte.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import Sheet from './Sheet.svelte';
  import Cover from './Cover.svelte';
  import Icon from './Icon.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  const LENGTHS = ['short', 'medium', 'long'] as const;
  let mood = $state<Mood | null>(null);
  let pace = $state<Pace | null>(null);
  let length = $state<(typeof LENGTHS)[number] | null>(null);
  let shown = $state<number[]>([]);
  let res = $state<{ book: BookBrief | null; total: number; matching: number; restarted: boolean } | null>(null);
  let busy = $state(false);

  async function roll(reset = false) {
    if (reset) shown = [];
    busy = true;
    try {
      const q = new URLSearchParams();
      if (mood) q.set('mood', mood);
      if (pace) q.set('pace', pace);
      if (length) q.set('length', length);
      if (shown.length) q.set('skip', shown.join(','));
      res = await api.get(`/home/next?${q}`);
      if (res?.restarted) shown = [];
      if (res?.book) shown = [...shown, res.book.id];
    } catch (e) { toastError(e); } finally { busy = false; }
  }

  $effect(() => { if (open) roll(true); });
  const filter = <T,>(cur: T | null, v: T) => (cur === v ? null : v);
</script>

<Sheet {open} {onclose} title={t('next.title')}>
  {#if res}
    {#if res.book}
      <a class="pick" href="/book/{res.book.id}" onclick={onclose}>
        <Cover url={res.book.coverUrl} title={res.book.title} authors={res.book.authors} />
        <div>
          <strong>{res.book.title}</strong>
          {#if res.book.authors.length}<p class="muted small">{res.book.authors.join(', ')}</p>{/if}
          {#if res.book.pages}<p class="muted small">{t('next.pages', { n: res.book.pages })}</p>{/if}
        </div>
      </a>
      <p class="muted small center">{tn('next.of', res.matching)}</p>
    {:else if res.total}
      <p class="muted center">{t('next.noneMatch')}</p>
    {:else}
      <p class="muted center">{t('next.empty')}</p>
    {/if}
  {/if}
  {#if !res || res.total}
    <div class="field">
      <span>{t('review.moods')}</span>
      <div class="chips">
        {#each MOODS as m}<button type="button" class:active={mood === m} aria-pressed={mood === m} onclick={() => { mood = filter(mood, m); roll(true); }}>{t(`mood.${m}`)}</button>{/each}
      </div>
    </div>
    <div class="field">
      <span>{t('review.pace')}</span>
      <div class="chips">
        {#each PACES as p}<button type="button" class:active={pace === p} aria-pressed={pace === p} onclick={() => { pace = filter(pace, p); roll(true); }}>{t(`pace.${p}`)}</button>{/each}
      </div>
    </div>
    <div class="field">
      <span>{t('next.length')}</span>
      <div class="chips">
        {#each LENGTHS as l}<button type="button" class:active={length === l} aria-pressed={length === l} onclick={() => { length = filter(length, l); roll(true); }}>{t(`next.${l}`)}</button>{/each}
      </div>
    </div>
    {#if mood || pace}<p class="muted small">{t('next.moodHint')}</p>{/if}
    <button class="primary wide" disabled={busy || !res?.matching} onclick={() => roll()}><Icon name="sparkle" size={18} /> {t('next.again')}</button>
  {/if}
</Sheet>

<style>
  .pick { display: grid; grid-template-columns: 96px 1fr; gap: 1rem; align-items: center; color: var(--text); margin: 0.4rem 0 0.6rem; }
  .pick:hover { text-decoration: none; }
  .pick strong { font-size: 1.05rem; }
  .pick p { margin: 0.2rem 0 0; }
  .center { text-align: center; }
  .field { display: grid; gap: 0.35em; margin: 0.7rem 0; font-size: 0.88rem; color: var(--muted); }
  .field > span { font-weight: 500; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chips button { font-size: 0.8rem; padding: 0.3em 0.75em; border-radius: 999px; white-space: normal; }
  .chips button.active { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .wide { width: 100%; justify-content: center; margin-top: 0.4rem; }
</style>
