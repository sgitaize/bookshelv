<script lang="ts">
  import { api } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { t, i18n, type Key } from '../lib/i18n.svelte.ts';
  import Icon from '../components/Icon.svelte';

  type Imp = {
    id: number; source: string; filename: string | null; total: number; createdAt: string; undoneAt: string | null;
    status: 'running' | 'done' | 'cancelled'; done: number; conflictCount: number;
    changes: Record<string, { added: number; changed: number }>;
  };
  let list = $state<Imp[] | null>(null);
  let busy = $state<number | null>(null);

  const load = () => api.get<Imp[]>('/imports').then(r => (list = r)).catch(toastError);
  // läuft noch ein Import: Fortschritt alle 3 s nachladen
  $effect(() => {
    load();
    const id = setInterval(() => { if (list?.some(i => i.status === 'running')) load(); }, 3000);
    return () => clearInterval(id);
  });

  const when = (ts: string) => new Date(ts.replace(' ', 'T') + 'Z').toLocaleString(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' });
  // nur die Tabellen, die für Menschen etwas bedeuten
  const PARTS = ['copies', 'user_books', 'reviews', 'wishlist', 'list_items', 'lists', 'books'] as const;

  async function undo(i: Imp) {
    if (!confirm(t('imp.undoQ'))) return;
    busy = i.id;
    try {
      const r = await api.post<{ reverted: number; skipped: number }>(`/imports/${i.id}/undo`);
      toast(r.skipped ? t('imp.undoneSkipped', { n: r.skipped }) : t('imp.undone'));
      load();
    } catch (e) { toastError(e); } finally { busy = null; }
  }
</script>

<section class="stack">
  <h1>{t('imp.history')}</h1>
  <p class="muted">{t('imp.historyInfo')}</p>
  <a class="btn primary new" href="/import"><Icon name="download" size={16} /> {t('imp.title')}</a>
  {#if list === null}
    <div class="spinner"></div>
  {:else if !list.length}
    <p class="empty">{t('imp.none')}</p>
  {:else}
    {#each list as i (i.id)}
      <div class="card imp" class:undone={!!i.undoneAt}>
        <div class="spread">
          <div class="head">
            <strong>{i.source}</strong>{#if i.filename} <span class="muted small">· {i.filename}</span>{/if}
            <p class="muted small">{when(i.createdAt)} · {t('imp.entries', { n: i.total })}</p>
            {#if i.status === 'running'}<p class="small"><span class="chip accent">{t('imp.statusRunning', { n: i.done, total: i.total })}</span> <a href="/import">{t('imp.showProgress')}</a></p>
            {:else if i.status === 'cancelled'}<p class="small"><span class="chip">{t('imp.statusCancelled', { n: i.done, total: i.total })}</span></p>{/if}
          </div>
          {#if i.undoneAt}
            <span class="chip">{t('imp.undoneOn', { d: when(i.undoneAt) })}</span>
          {:else}
            <button class="small ghost danger" onclick={() => undo(i)} disabled={busy === i.id}>{t('imp.undo')}</button>
          {/if}
        </div>
        <ul class="parts">
          {#each PARTS.filter(p => i.changes[p]) as p}
            <li>{t(`imp.part.${p}` as Key, { a: i.changes[p].added, c: i.changes[p].changed })}</li>
          {/each}
          {#if !Object.keys(i.changes).length}<li class="muted">{t('imp.noChanges')}</li>{/if}
        </ul>
      </div>
    {/each}
  {/if}
</section>

<style>
  section { max-width: 720px; margin: 0 auto; }
  .new { justify-self: start; }
  .imp { padding: 0.9rem 1rem; display: grid; gap: 0.4rem; }
  .imp.undone { opacity: 0.6; }
  .head { min-width: 0; overflow-wrap: anywhere; }
  .head p { margin: 0.1rem 0 0; }
  .parts { margin: 0; padding-left: 1.1rem; font-size: 0.9rem; display: grid; gap: 0.1rem; }
</style>
