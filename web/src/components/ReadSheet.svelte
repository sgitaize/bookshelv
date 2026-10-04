<script lang="ts">
  // Leserunde zu einem Buch starten: Personen der Instanz auswählen, optional Notiz und Zieldatum
  import { api, type ListMember } from '../lib/api.ts';
  import { session, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Sheet from './Sheet.svelte';
  import Avatar from './Avatar.svelte';

  let { bookId, open, onclose }: { bookId: number; open: boolean; onclose: () => void } = $props();

  let people = $state<ListMember[] | null>(null);
  let picked = $state<number[]>([]);
  let note = $state('');
  let endsAt = $state('');
  let filter = $state('');
  let busy = $state(false);

  $effect(() => {
    if (open && !people) api.get<ListMember[]>('/users').then(r => (people = r.filter(p => p.id !== session.me?.id))).catch(e => { toastError(e); people = []; });
  });
  const shown = $derived((people ?? []).filter(p => !filter || `${p.displayName} ${p.username}`.toLowerCase().includes(filter.toLowerCase())));
  const toggle = (id: number) => (picked = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]);

  async function start() {
    busy = true;
    try {
      const r = await api.post<{ id: number }>('/reads', { bookId, memberIds: picked, note: note.trim() || null, endsAt: endsAt || null });
      onclose();
      router.go(`/reads/${r.id}`);
    } catch (e) { toastError(e); } finally { busy = false; }
  }
</script>

<Sheet {open} {onclose} title={t('reads.start')}>
  <div class="stack">
    <p class="muted small">{t('reads.startInfo')}</p>
    {#if people === null}
      <div class="spinner"></div>
    {:else if !people.length}
      <p class="muted">{t('list.memberNone')}</p>
    {:else}
      {#if people.length > 8}<input bind:value={filter} placeholder={t('reads.filterPeople')} />{/if}
      <div class="people">
        {#each shown as p (p.id)}
          <label class="person" class:on={picked.includes(p.id)}>
            <input type="checkbox" checked={picked.includes(p.id)} onchange={() => toggle(p.id)} />
            <Avatar name={p.displayName} url={p.avatarUrl} size={28} />
            <span class="nm">{p.displayName}</span>
          </label>
        {/each}
      </div>
    {/if}
    <label class="field">{t('reads.note')}<input bind:value={note} maxlength="300" placeholder={t('reads.notePh')} /></label>
    <label class="field">{t('reads.endsAt')}<input type="date" bind:value={endsAt} /></label>
    <button class="primary" disabled={busy || !picked.length} onclick={start}>{t('reads.startBtn', { n: picked.length })}</button>
  </div>
</Sheet>

<style>
  .people { display: grid; gap: 0.35rem; max-height: 40vh; overflow-y: auto; }
  .person { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.6rem; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; min-width: 0; }
  .person.on { border-color: var(--accent); }
  .person input { width: auto; margin: 0; }
  .nm { overflow-wrap: anywhere; min-width: 0; }
</style>
