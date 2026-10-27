<script lang="ts">
  import { publicOrigin } from '../lib/app.svelte.ts';
  import { isLocal } from '../lib/state.svelte.ts';
  import { api, labels, type BookBrief, type ReadingList, type ListVisibility, type ListMember } from '../lib/api.ts';
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
  // Ansicht der Liste (Liste, Tabelle, quadratisches Raster) – gilt für alle Listen, bleibt auf dem Gerät gespeichert
  const VIEWS = ['list', 'table', 'grid'] as const;
  type View = (typeof VIEWS)[number];
  const VIEW_KEY = 'bookshelv-list-view';
  let view = $state<View>(VIEWS.find(v => v === localStorage.getItem(VIEW_KEY)) ?? 'list');
  const viewIcon = { list: 'list', table: 'table', grid: 'grid' } as const;
  const viewLabel = (v: View) => t(v === 'list' ? 'list.viewList' : v === 'table' ? 'list.viewTable' : 'list.viewGrid');
  function setView(v: View) { view = v; try { localStorage.setItem(VIEW_KEY, v); } catch { /* voll */ } }

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
    const url = `${publicOrigin()}/lists/${id}`;
    if (navigator.share) { try { await navigator.share({ title: l!.name, url }); return; } catch { /* abgebrochen → kopieren */ } }
    await navigator.clipboard.writeText(url);
    toast(t('invite.copied'));
  }

  async function add(b: BookBrief) {
    try { await api.put(`/lists/${id}/books/${b.id}`, {}); toast(t('list.bookAdded', { title: b.title }), 'ok', 'list-pick'); await load(); } catch (err) { toastError(err); }
  }
  async function unpick(b: BookBrief) {
    await drop(b.id);
    if (!l!.items.some(x => x.book.id === b.id)) toast(t('list.bookRemoved', { title: b.title }), 'ok', 'list-pick');
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
          {#if !l.mine}<a href="/people/{l.owner.id}">{l.owner.displayName}</a> · {/if}{tn('list.books', l.items.length)}{#if !isLocal()} · {l.visibility === 'private' ? t('vis.private') : t('list.visPublic')}{/if} · {t('list.updated', { d: fmtDate(l.updatedAt) })}
        </p>
      </div>
      <div class="row">
        {#if !isLocal()}<button class="icon ghost" onclick={openShare} aria-label={t('list.share')}><Icon name="users" /></button>{/if}
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
    <div class="spread toolbar">
      {#if l.canEdit}<button class="small addbtn" onclick={() => (adding = true)}><Icon name="plus" size={16} /> {t('list.addBooks')}</button>{:else}<span></span>{/if}
      {#if l.items.length}
        <div class="segmented views" role="group" aria-label={t('list.view')}>
          {#each VIEWS as v}
            <button class:active={view === v} aria-pressed={view === v} aria-label={viewLabel(v)} title={viewLabel(v)} onclick={() => setView(v)}><Icon name={viewIcon[v]} size={18} /></button>
          {/each}
        </div>
      {/if}
    </div>

    {#if !l.items.length}
      <p class="empty">{l.canEdit ? t('list.emptyMine') : t('list.empty')}</p>
    {:else if view === 'grid'}
      <ol class="grid">
        {#each l.items as it, i (it.book.id)}
          <li>
            <a href="/book/{it.book.id}" class="tile" title="{it.book.title} – {it.book.authors.join(', ')}">
              <Cover url={it.book.coverUrl} title={it.book.title} authors={it.book.authors} />
              <span class="badge">{i + 1}</span>
              {#if it.myStatus === 'read'}<span class="done"><Icon name="check" size={14} /></span>{/if}
            </a>
          </li>
        {/each}
      </ol>
    {:else if view === 'table'}
      <div class="tablewrap">
        <table>
          <thead>
            <tr><th class="num">#</th><th>{t('list.colTitle')}</th><th class="wide">{t('list.colAuthor')}</th><th class="num">{t('list.colYear')}</th><th>{t('list.colStatus')}</th>{#if l.canEdit}<th></th>{/if}</tr>
          </thead>
          <tbody>
            {#each l.items as it, i (it.book.id)}
              <tr>
                <td class="num pos">{i + 1}</td>
                <td class="ttl"><a href="/book/{it.book.id}">{it.book.title}</a><span class="narrow muted small">{it.book.authors.join(', ')}</span></td>
                <td class="muted wide">{it.book.authors.join(', ')}</td>
                <td class="num muted">{it.book.year ?? ''}</td>
                <td class="muted">{it.myStatus !== 'unread' ? labels.read[it.myStatus] : ''}</td>
                {#if l.canEdit}<td class="tacts"><button class="icon ghost" onclick={() => drop(it.book.id)} aria-label={t('list.remove')}><Icon name="x" size={16} /></button></td>{/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
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
      {#if !isLocal()}
      <div class="segmented">
        <button type="button" class:active={form.visibility === 'instance'} onclick={() => (form.visibility = 'instance')}>{t('list.visPublic')}</button>
        <button type="button" class:active={form.visibility === 'private'} onclick={() => (form.visibility = 'private')}>{t('vis.private')}</button>
      </div>
      {/if}
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
    <BookPicker catalog selected={l.items.map(x => x.book.id)} onpick={add} onunpick={unpick} />
  </Sheet>
{/if}

<style>
  section { max-width: 760px; margin: 0 auto; }
  .head { min-width: 0; }
  .head h1 { margin-bottom: 0.1rem; overflow-wrap: anywhere; }
  .head p { margin: 0; }
  .desc { white-space: pre-line; margin: 0; }
  .addbtn { justify-self: start; }
  .toolbar { align-items: center; }
  .views button { padding: 0.35em 0.7em; display: grid; place-items: center; }
  /* Raster: quadratische Kacheln, Cover füllt die Kachel */
  .grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(110px, 30%), 1fr)); gap: 0.5rem; }
  .tile { position: relative; display: block; border-radius: 8px; overflow: hidden; }
  .tile :global(.cover) { aspect-ratio: 1; border-radius: 8px; }
  .tile :global(.cover::after) { display: none; }
  .badge, .done { position: absolute; top: 0.3rem; font-size: 0.72rem; font-weight: 700; min-width: 1.4rem; height: 1.4rem; padding: 0 0.3rem; border-radius: 999px; display: grid; place-items: center; }
  .badge { left: 0.3rem; background: rgb(0 0 0 / 0.6); color: #fff; }
  .done { right: 0.3rem; background: var(--accent); color: var(--accent-ink); }
  /* Tabelle: kompakt, bei Bedarf seitlich scrollbar statt die Seite zu sprengen */
  .tablewrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th, td { text-align: left; padding: 0.45rem 0.6rem; border-top: 1px solid var(--line); vertical-align: middle; }
  thead th { border-top: none; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; white-space: nowrap; }
  td.ttl { min-width: 9rem; font-weight: 600; }
  td.ttl a { color: var(--text); }
  td.muted { min-width: 6rem; }
  .num { text-align: right; white-space: nowrap; }
  td.pos { color: var(--accent); font-weight: 700; }
  .tacts { width: 1px; padding: 0 0.2rem; }
  .tacts .icon { width: 30px; height: 30px; }
  .narrow { display: none; font-weight: 400; }
  /* schmal: Autor*innen unter den Titel, damit Jahr und Status sichtbar bleiben */
  @media (max-width: 560px) {
    .wide { display: none; }
    .narrow { display: block; }
    td.ttl { min-width: 0; }
    td.muted { min-width: 0; }
  }
  .items { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.45rem; }
  .item { display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0.7rem; }
  .pos { width: 1.5rem; text-align: center; font-weight: 700; color: var(--accent); flex: none; }
  .cov { flex: none; }
  .grow { flex: 1; min-width: 0; display: grid; color: var(--text); }
  .grow:hover { text-decoration: none; }
  .grow strong { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
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
