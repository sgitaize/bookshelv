<script lang="ts" module>
  // gemeinsamer Zwischenspeicher: Buchseiten wechseln oft, die Liste ändert sich selten
  import { api } from '../lib/api.ts';
  export const followed = $state<{ names: Set<string> | null }>({ names: null });
  export const loadFollowed = () => api.get<string[]>('/authors/following').then(r => (followed.names = new Set(r))).catch(() => {});
</script>

<script lang="ts">
  // Autor*innen auf der Buchseite, jeweils mit Folgen-Knopf (Neuerscheinungen kommen dann über die Glocke)
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Icon from './Icon.svelte';

  let { authors }: { authors: string[] } = $props();
  $effect(() => { if (!followed.names) loadFollowed(); });

  async function toggle(name: string) {
    const on = followed.names?.has(name);
    try {
      await api.post(on ? '/authors/unfollow' : '/authors/follow', { name });
      const s = new Set(followed.names ?? []);
      if (on) s.delete(name); else s.add(name);
      followed.names = s;
      if (!on) toast(t('authors.followed', { name }));
    } catch (e) { toastError(e); }
  }
</script>

<p class="authors">
  {#if !authors.length}{t('book.unknownAuthor')}{/if}
  {#each authors as a, i (a)}
    <span class="au">{a}<button class="fol" class:on={followed.names?.has(a)} onclick={() => toggle(a)} aria-pressed={followed.names?.has(a) ?? false}
      title={followed.names?.has(a) ? t('authors.unfollow') : t('authors.follow')}>
      <Icon name={followed.names?.has(a) ? 'check' : 'plus'} size={12} /> {followed.names?.has(a) ? t('authors.following') : t('authors.follow')}
    </button></span>{#if i < authors.length - 1}<span class="sep">, </span>{/if}
  {/each}
</p>

<style>
  .authors { font-weight: 600; color: var(--accent); line-height: 1.9; }
  .au { overflow-wrap: anywhere; }
  .fol { margin-left: 0.35rem; vertical-align: middle; }
  .fol { font-size: 0.72rem; padding: 0.15rem 0.5rem; border-radius: 999px; font-weight: 500; display: inline-flex; align-items: center; gap: 0.2rem; }
  .fol.on { background: color-mix(in srgb, var(--accent) 20%, transparent); border-color: transparent; color: var(--accent); }
  .sep { color: var(--muted); }
</style>
