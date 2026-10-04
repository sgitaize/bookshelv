<script lang="ts">
  import { api, labels, type ReadingList, type ListVisibility, type ListMember } from '../lib/api.ts';
  import { session, toast, toastError } from '../lib/state.svelte.ts';
  import Avatar from '../components/Avatar.svelte';
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
  let sharing = $state(false);
  let people = $state<ListMember[]>([]);
  let pick = $state('');
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
  /** Mitglieder: Besitzer*in lädt Personen der Instanz ein, Mitglieder können austreten */
  async function openShare() {
    sharing = true;
    if (!people.length) people = await api.get<ListMember[]>('/users').catch(e => (toastError(e), []));
  }
  const candidates = $derived(people.filter(p => p.id !== session.me?.id && !l?.members.some(m => m.id === p.id)));
  async function addMember() {
    if (!pick) return;
    try { const r = await api.post<{ members: ListMember[] }>(`/lists/${id}/members`, { userId: Number(pick) }); l!.members = r.members; pick = ''; toast(t('list.memberAdded')); }
    catch (err) { toastError(err); }
  }
  async function dropMember(m: ListMember) {
    if (!confirm(t('list.memberRemoveQ', { name: m.displayName }))) return;
    try { const r = await api.del<{ members: ListMember[] }>(`/lists/${id}/members/${m.id}`); l!.members = r.members; } catch (err) { toastError(err); }
  }
  async function leave() {
    if (!confirm(t('list.leaveQ', { name: l!.name }))) return;
    try { await api.del(`/lists/${id}/members/${session.me!.id}`); toast(t('list.left')); router.go('/lists', true); } catch (err) { toastError(err); }
  }
  async function shareLink() {
    const url = `${location.origin}/lists/${id}`;
    if (navigator.share) { try { await navigator.share({ title: l!.name, url }); return; } catch { /* abgebrochen → kopieren */ } }
    await navigator.clipboard.writeText(url);
    toast(t('invite.copied'));
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
      <div class="row">
        <button class="icon ghost" onclick={openShare} aria-label={t('list.share')}><Icon name="users" /></button>
      {#if l.mine}
          <button class="icon ghost" onclick={openEdit} aria-label={t('common.edit')}><Icon name="edit" /></button>
          <button class="icon ghost" onclick={remove} aria-label={t('common.delete')}><Icon name="trash" /></button>
      {/if}
      </div>
    </div>
    {#if l.members.length}
      <button class="members" onclick={openShare}>
        <span class="avs">
          <Avatar name={l.owner.displayName} url={l.owner.avatarUrl} size={28} />
          {#each l.members.slice(0, 5) as m (m.id)}<Avatar name={m.displayName} url={m.avatarUrl} size={28} />{/each}
        </span>
        <span class="muted small">{t('list.sharedWith', { n: l.members.length + 1 })}</span>
      </button>
    {/if}
    {#if l.description}<p class="desc">{l.description}</p>{/if}
    {#if l.canEdit}<button class="small addbtn" onclick={() => (adding = true)}><Icon name="plus" size={16} /> {t('list.addBooks')}</button>{/if}

    {#if !l.items.length}
      <p class="empty">{l.canEdit ? t('list.emptyMine') : t('list.empty')}</p>
    {:else}
      <ol class="items">
        {#each l.items as it, i (it.book.id)}
          <li class="card item">
            <span class="pos">{i + 1}</span>
            <a href="/book/{it.book.id}" class="cov"><Cover url={it.book.coverUrl} title={it.book.title} authors={it.book.authors} size="sm" /></a>
            <a href="/book/{it.book.id}" class="grow">
              <strong>{it.book.title}</strong>
              <span class="muted small">{it.book.authors.join(', ')}{#if it.myStatus !== 'unread'} · {labels.read[it.myStatus]}{/if}{#if it.addedBy} · {t('list.addedBy', { name: it.addedBy.displayName })}{/if}</span>
            </a>
            {#if l.canEdit}
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

  <Sheet open={sharing} onclose={() => (sharing = false)} title={t('list.share')}>
    <div class="stack">
      <p class="muted small">{t('list.shareInfo')}</p>
      <ul class="mlist">
        <li><Avatar name={l.owner.displayName} url={l.owner.avatarUrl} size={32} /><span class="grow"><strong>{l.owner.displayName}</strong><span class="muted small">{t('list.ownerRole')}</span></span></li>
        {#each l.members as m (m.id)}
          <li>
            <Avatar name={m.displayName} url={m.avatarUrl} size={32} />
            <span class="grow"><strong>{m.displayName}</strong><span class="muted small">@{m.username}</span></span>
            {#if l.mine}<button class="icon ghost danger" onclick={() => dropMember(m)} aria-label={t('list.memberRemove')}><Icon name="x" size={18} /></button>{/if}
          </li>
        {/each}
      </ul>
      {#if l.mine}
        <div class="row">
          <select bind:value={pick} class="grow" aria-label={t('list.memberPick')}>
            <option value="">{candidates.length ? t('list.memberPick') : t('list.memberNone')}</option>
            {#each candidates as p (p.id)}<option value={String(p.id)}>{p.displayName} (@{p.username})</option>{/each}
          </select>
          <button class="primary" disabled={!pick} onclick={addMember}><Icon name="plus" size={16} /> {t('list.memberAdd')}</button>
        </div>
        {#if l.visibility === 'private'}<p class="muted small">{t('list.sharePrivate')}</p>{/if}
      {/if}
      {#if l.visibility === 'instance' || l.canEdit}
        <button onclick={shareLink}><Icon name="link" size={16} /> {t('list.copyLink')}</button>
      {/if}
      {#if !l.mine && l.canEdit}
        <button class="ghost danger" onclick={leave}>{t('list.leave')}</button>
      {/if}
    </div>
  </Sheet>

  <Sheet open={adding} onclose={() => (adding = false)} title={t('list.addBooks')}>
    <p class="muted small">{t('list.addHint')}</p>
    <BookPicker catalog exclude={l.items.map(x => x.book.id)} onpick={b => add(b.id)} />
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
  .members { display: flex; align-items: center; gap: 0.6rem; justify-self: start; border: none; background: none; padding: 0; }
  .avs { display: flex; }
  .avs > :global(*) { margin-left: -6px; box-shadow: 0 0 0 2px var(--bg); border-radius: 50%; }
  .avs > :global(*:first-child) { margin-left: 0; }
  .mlist { list-style: none; margin: 0; padding: 0; display: grid; }
  .mlist li { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0; border-top: 1px solid var(--line); }
  .mlist li:first-child { border-top: none; }
  .mlist .grow { display: grid; }
  @media (max-width: 420px) { .acts .icon { width: 34px; } }
</style>
