<script lang="ts">
  import { api, labels, type ReadingList, type ListVisibility } from '../lib/api.ts';
  import { toast, toastError } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, tn, fmtDate } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Icon from '../components/Icon.svelte';
  import BookPicker from '../components/BookPicker.svelte';

  let { id }: { id: number } = $props();
  let l = $state<ReadingList | null>(null);
  let editing = $state(false);
  let adding = $state(false);
  let form = $state({ name: '', description: '', visibility: 'instance' as ListVisibility });

  const load = () => api.get<ReadingList>(`/lists/${id}`).then(r => (l = r)).catch(toastError);
  $effect(() => { load(); });

  function openEdit() {
    form = { name: l!.name, description: l!.description ?? '', visibility: l!.visibility };
    editing = true;
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    try { await api.patch(`/lists/${id}`, form); editing = false; toast(t('common.saved')); load(); } catch (err) { toastError(err); }
  }
  async function remove() {
    if (!confirm(t('list.deleteQ', { name: l!.name }))) return;
    try { await api.del(`/lists/${id}`); toast(t('common.deleted')); router.go('/lists', true); } catch (err) { toastError(err); }
  }
  async function move(i: number, d: number) {
    const items = [...l!.items];
    [items[i], items[i + d]] = [items[i + d], items[i]];
    l!.items = items;
    try { await api.put(`/lists/${id}/order`, { bookIds: items.map(x => x.book.id) }); } catch (err) { toastError(err); load(); }
  }
  async function drop(bookId: number) {
    try { await api.del(`/lists/${id}/books/${bookId}`); l!.items = l!.items.filter(x => x.book.id !== bookId); } catch (err) { toastError(err); }
  }
  async function add(bookId: number) {
    try { await api.put(`/lists/${id}/books/${bookId}`, {}); await load(); } catch (err) { toastError(err); }
  }
</script>

{#if !l}
  <div class="spinner"></div>
{:else}
  <section class="stack">
    <div class="spread">
      <div class="head">
        <h1>{l.name}</h1>
        <p class="muted small">
          {#if !l.mine}<a href="/people/{l.owner.id}">{l.owner.displayName}</a> · {/if}{tn('list.books', l.items.length)} · {l.visibility === 'private' ? t('vis.private') : t('list.visPublic')} · {t('list.updated', { d: fmtDate(l.updatedAt) })}
        </p>
      </div>
      {#if l.mine}
        <div class="row">
          <button class="icon ghost" onclick={openEdit} aria-label={t('common.edit')}><Icon name="edit" /></button>
          <button class="icon ghost" onclick={remove} aria-label={t('common.delete')}><Icon name="trash" /></button>
        </div>
      {/if}
    </div>
    {#if l.description}<p class="desc">{l.description}</p>{/if}
    {#if l.mine}<button class="small addbtn" onclick={() => (adding = true)}><Icon name="plus" size={16} /> {t('list.addBooks')}</button>{/if}

    {#if !l.items.length}
      <p class="empty">{l.mine ? t('list.emptyMine') : t('list.empty')}</p>
    {:else}
      <ol class="items">
        {#each l.items as it, i (it.book.id)}
          <li class="card item">
            <span class="pos">{i + 1}</span>
            <a href="/book/{it.book.id}" class="cov"><Cover url={it.book.coverUrl} title={it.book.title} authors={it.book.authors} size="sm" /></a>
            <a href="/book/{it.book.id}" class="grow">
              <strong>{it.book.title}</strong>
              <span class="muted small">{it.book.authors.join(', ')}{#if it.myStatus !== 'unread'} · {labels.read[it.myStatus]}{/if}</span>
            </a>
            {#if l.mine}
              <div class="acts">
                <button class="icon ghost" disabled={i === 0} onclick={() => move(i, -1)} aria-label={t('list.up')}><Icon name="up" size={18} /></button>
                <button class="icon ghost" disabled={i === l.items.length - 1} onclick={() => move(i, 1)} aria-label={t('list.down')}><Icon name="down" size={18} /></button>
                <button class="icon ghost" onclick={() => drop(it.book.id)} aria-label={t('list.remove')}><Icon name="x" size={18} /></button>
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <Sheet open={editing} onclose={() => (editing = false)} title={t('list.edit')}>
    <form class="stack" onsubmit={save}>
      <label class="field"><span>{t('list.name')}</span><input bind:value={form.name} required maxlength="80" /></label>
      <label class="field"><span>{t('list.description')}</span><textarea bind:value={form.description} maxlength="1000" rows="3"></textarea></label>
      <div class="segmented">
        <button type="button" class:active={form.visibility === 'instance'} onclick={() => (form.visibility = 'instance')}>{t('list.visPublic')}</button>
        <button type="button" class:active={form.visibility === 'private'} onclick={() => (form.visibility = 'private')}>{t('vis.private')}</button>
      </div>
      <button class="primary">{t('common.save')}</button>
    </form>
  </Sheet>

  <Sheet open={adding} onclose={() => (adding = false)} title={t('list.addBooks')}>
    <p class="muted small">{t('list.addHint')}</p>
    <BookPicker exclude={l.items.map(x => x.book.id)} onpick={b => add(b.id)} />
  </Sheet>
{/if}

<style>
  section { max-width: 760px; margin: 0 auto; }
  .head { min-width: 0; }
  .head h1 { margin-bottom: 0.1rem; overflow-wrap: anywhere; }
  .head p { margin: 0; }
  .desc { white-space: pre-line; margin: 0; }
  .addbtn { justify-self: start; }
  .items { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.45rem; }
  .item { display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0.7rem; }
  .pos { width: 1.5rem; text-align: center; font-weight: 700; color: var(--accent); flex: none; }
  .cov { width: 44px; flex: none; }
  .grow { flex: 1; min-width: 0; display: grid; color: var(--text); }
  .grow:hover { text-decoration: none; }
  .grow strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acts { display: flex; flex: none; }
  @media (max-width: 420px) { .acts .icon { width: 34px; } }
</style>
