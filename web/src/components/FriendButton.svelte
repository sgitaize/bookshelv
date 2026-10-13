<script lang="ts">
  // Freundschaft mit einer Person: anfragen, Anfrage zurückziehen, annehmen/ablehnen, beenden
  import { api, type Relation } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import Icon from './Icon.svelte';

  let { userId, relation = $bindable(), compact = false, onchange }: { userId: number; relation: Relation; compact?: boolean; onchange?: (r: Relation) => void } = $props();
  let busy = $state(false);

  async function run(method: 'post' | 'del', confirmKey?: 'friend.endQ') {
    if (confirmKey && !confirm(t(confirmKey))) return;
    busy = true;
    try {
      const r = await (method === 'post' ? api.post<{ relation: Relation }>(`/users/${userId}/friend`) : api.del<{ relation: Relation }>(`/users/${userId}/friend`));
      if (r.relation === 'friend' && relation === 'incoming') toast(t('friend.nowFriends'));
      relation = r.relation;
      onchange?.(r.relation);
    } catch (e) { toastError(e); } finally { busy = false; }
  }
</script>

<span class="fb" class:compact>
  {#if relation === 'none'}
    <button class="btn primary small" disabled={busy} onclick={() => run('post')}><Icon name="plus" size={14} /> {t('friend.add')}</button>
  {:else if relation === 'outgoing'}
    <span class="chip">{t('friend.requested')}</span>
    <button class="btn ghost small" disabled={busy} onclick={() => run('del')}>{t('friend.withdraw')}</button>
  {:else if relation === 'incoming'}
    <button class="btn primary small" disabled={busy} onclick={() => run('post')}><Icon name="check" size={14} /> {t('friend.accept')}</button>
    <button class="btn ghost small" disabled={busy} onclick={() => run('del')}>{t('friend.decline')}</button>
  {:else if relation === 'friend' && !compact}
    <span class="chip accent"><Icon name="check" size={12} /> {t('friend.is')}</span>
    <button class="btn ghost small" disabled={busy} onclick={() => run('del', 'friend.endQ')}>{t('friend.end')}</button>
  {/if}
</span>

<style>
  .fb { display: inline-flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; justify-content: center; }
</style>
