<script lang="ts">
  import { api, labels, type BookBrief, type ReadStatus } from '../lib/api.ts';
  import { toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Cover from './Cover.svelte';

  // Suche in den eigenen Büchern (gelesen zuerst); onpick bekommt das gewählte Buch
  let { onpick, exclude = [] }: { onpick: (b: BookBrief) => void; exclude?: number[] } = $props();
  let q = $state('');
  let hits = $state<{ status: ReadStatus; book: BookBrief }[]>([]);
  let timer: ReturnType<typeof setTimeout>;

  $effect(() => {
    const query = q;
    clearTimeout(timer);
    timer = setTimeout(() => api.get<typeof hits>(`/me/books?q=${encodeURIComponent(query)}`).then(r => (hits = r)).catch(toastError), 200);
  });
</script>

<input type="search" bind:value={q} placeholder={t('top.searchPh')} />
<div class="hits">
  {#each hits.filter(h => !exclude.includes(h.book.id)) as h (h.book.id)}
    <button class="hit ghost" onclick={() => onpick(h.book)}>
      <Cover url={h.book.coverUrl} title={h.book.title} authors={h.book.authors} size="sm" />
      <span class="grow"><strong>{h.book.title}</strong><span class="muted small">{h.book.authors.join(', ')} · {labels.read[h.status]}</span></span>
    </button>
  {:else}
    <p class="muted small">{t('add.noHits')}</p>
  {/each}
</div>

<style>
  .hits { display: grid; gap: 0.3rem; max-height: 50dvh; overflow: auto; margin-top: 0.6rem; }
  .hit { display: flex; gap: 0.7rem; align-items: center; text-align: left; padding: 0.4rem; justify-content: flex-start; height: auto; }
  .hit :global(.cover) { width: 40px; flex: none; }
  .grow { display: grid; min-width: 0; }
  .grow strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
