<script lang="ts">
  import type { BookBrief } from '../lib/api.ts';
  import Sheet from './Sheet.svelte';
  import Cover from './Cover.svelte';
  import { tn } from '../lib/i18n.svelte.ts';

  // Bücher hinter einem Diagrammabschnitt (Statistik: Abschnitt antippen)
  let { pick, onclose }: { pick: { title: string; books: BookBrief[] } | null; onclose: () => void } = $props();
</script>

<Sheet open={!!pick} {onclose} title={pick?.title}>
  {#if pick}
    <p class="muted small">{tn('list.books', pick.books.length)}</p>
    <ul class="grid">
      {#each pick.books as b (b.id)}
        <li><a href="/book/{b.id}" onclick={onclose}>
          <Cover url={b.coverUrl} title={b.title} authors={b.authors} size="sm" />
          <span class="t">{b.title}</span>
          <span class="muted a">{b.authors[0] ?? ''}</span>
        </a></li>
      {/each}
    </ul>
  {/if}
</Sheet>

<style>
  .grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.8rem 0.6rem; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); }
  a { display: grid; gap: 0.2rem; color: inherit; text-decoration: none; }
  .t { font-size: 0.78rem; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .a { font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
