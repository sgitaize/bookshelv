<script lang="ts">
  // Leserunde: Mitglieder mit Fortschritt, Beiträge nach Buchposition; was hinter dem eigenen Stand liegt, bleibt verdeckt
  import { api, ago, type BuddyRead, type BuddyPost, type ListMember } from '../lib/api.ts';
  import { toast, toastError, session } from '../lib/state.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { t, fmtDate } from '../lib/i18n.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Avatar from '../components/Avatar.svelte';
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';

  let { id }: { id: number } = $props();
  let data = $state<(BuddyRead & { posts: BuddyPost[] }) | null>(null);
  let text = $state('');
  let page = $state('');
  let busy = $state(false);

  const load = () => api.get<BuddyRead & { posts: BuddyPost[] }>(`/reads/${id}`).then(r => {
    data = r;
    if (!page) page = r.book.pages ? String(Math.round((r.myPosition / 100) * r.book.pages)) : String(r.myPosition);
  }).catch(toastError);
  $effect(() => { load(); });

  const pages = $derived(data?.book.pages ?? null);
  const where = (p: { position: number; page: number | null }) => p.page != null ? t('reads.atPage', { n: p.page }) : t('reads.atPct', { n: p.position });

  async function post() {
    if (!text.trim()) return;
    busy = true;
    try {
      const n = page === '' ? undefined : Number(page);
      await api.post(`/reads/${id}/posts`, { text: text.trim(), ...(pages ? { page: n } : { percent: n }) });
      text = '';
      await load();
    } catch (e) { toastError(e); } finally { busy = false; }
  }
  async function delPost(p: BuddyPost) {
    if (!confirm(t('reads.deletePostQ'))) return;
    try { await api.del(`/reads/${id}/posts/${p.id}`); await load(); } catch (e) { toastError(e); }
  }

  // Mitglieder verwalten
  let manage = $state(false);
  let people = $state<ListMember[]>([]);
  let pick = $state('');
  const candidates = $derived(people.filter(p => !data?.members.some(m => m.id === p.id)));
  async function openManage() {
    manage = true;
    if (!people.length) people = await api.get<ListMember[]>('/users').catch(e => (toastError(e), []));
  }
  async function addMember() {
    try { await api.post(`/reads/${id}/members`, { userId: Number(pick) }); pick = ''; await load(); } catch (e) { toastError(e); }
  }
  async function removeMember(userId: number) {
    try { await api.del(`/reads/${id}/members/${userId}`); await load(); } catch (e) { toastError(e); }
  }
  async function leave() {
    if (!confirm(t('reads.leaveQ'))) return;
    try { await api.del(`/reads/${id}/members/${session.me!.id}`); toast(t('reads.left')); router.go('/reads', true); } catch (e) { toastError(e); }
  }
  async function remove() {
    if (!confirm(t('reads.deleteQ'))) return;
    try { await api.del(`/reads/${id}`); router.go('/reads', true); } catch (e) { toastError(e); }
  }
</script>

{#if !data}
  <div class="spinner"></div>
{:else}
  <section class="stack">
    <a href="/reads" class="back small"><Icon name="back" size={14} /> {t('reads.title')}</a>
    <header class="head">
      <a href="/book/{data.book.id}" class="cv"><Cover url={data.book.coverUrl} title={data.book.title} authors={data.book.authors} size="sm" /></a>
      <div class="grow">
        <p class="kicker">{t('reads.kicker')}</p>
        <h1><a href="/book/{data.book.id}">{data.book.title}</a></h1>
        <p class="muted small">{data.book.authors.join(', ')}{#if data.endsAt}{' · '}{t('reads.until', { d: fmtDate(data.endsAt) })}{/if}</p>
        {#if data.note}<p class="note">{data.note}</p>{/if}
      </div>
      <button class="icon ghost" onclick={openManage} aria-label={t('reads.manage')}><Icon name="users" /></button>
    </header>

    <div class="card members">
      {#each data.members as m (m.id)}
        <div class="member">
          <Avatar name={m.displayName} url={m.avatarUrl} size={28} />
          <span class="nm">{m.displayName}{#if m.id === session.me?.id}{' '}({t('reads.you')}){/if}</span>
          <span class="bar" aria-hidden="true"><span style="width: {m.position}%"></span></span>
          <span class="pct small">{m.position}%</span>
        </div>
      {/each}
      <a class="small" href="/book/{data.book.id}">{t('reads.updateProgress')} →</a>
    </div>

    <form class="card compose" onsubmit={e => { e.preventDefault(); post(); }}>
      <textarea bind:value={text} rows="3" maxlength="2000" placeholder={t('reads.postPh')}></textarea>
      <div class="row">
        <label class="small muted pos">{pages ? t('reads.page') : t('reads.percent')}
          <input type="number" inputmode="numeric" min="0" max={pages ?? 100} bind:value={page} />
        </label>
        <button class="primary" disabled={busy || !text.trim()}>{t('reads.post')}</button>
      </div>
      <p class="muted small">{t('reads.spoilerInfo')}</p>
    </form>

    {#if !data.posts.length}
      <p class="empty">{t('reads.noPosts')}</p>
    {:else}
      <ol class="posts">
        {#each data.posts as p (p.id)}
          <li class="post" class:locked={p.locked}>
            <div class="pmark">{where(p)}</div>
            <div class="card pbody">
              <div class="phead">
                <Avatar name={p.user.displayName} url={p.user.avatarUrl} size={24} />
                <strong class="small">{p.user.displayName}</strong>
                <span class="muted small">{ago(p.createdAt)}</span>
                {#if p.mine || data.mine}<button class="icon ghost del" onclick={() => delPost(p)} aria-label={t('common.delete')}><Icon name="trash" size={14} /></button>{/if}
              </div>
              {#if p.locked}
                <p class="muted lock"><Icon name="lock" size={14} /> {t('reads.locked', { where: where(p) })}</p>
              {:else}
                <p class="txt">{p.text}</p>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <Sheet open={manage} onclose={() => (manage = false)} title={t('reads.manage')}>
    <div class="stack">
      {#each data.members as m (m.id)}
        <div class="row mrow">
          <Avatar name={m.displayName} url={m.avatarUrl} size={28} />
          <span class="grow nm">{m.displayName}{#if m.owner}{' · '}{t('reads.owner')}{/if}</span>
          {#if data.mine && !m.owner}<button class="small ghost danger" onclick={() => removeMember(m.id)}>{t('reads.remove')}</button>{/if}
        </div>
      {/each}
      {#if data.mine}
        <div class="row">
          <select bind:value={pick} class="grow" aria-label={t('list.memberPick')}>
            <option value="">{candidates.length ? t('list.memberPick') : t('list.memberNone')}</option>
            {#each candidates as p (p.id)}<option value={String(p.id)}>{p.displayName} (@{p.username})</option>{/each}
          </select>
          <button class="primary" disabled={!pick} onclick={addMember}><Icon name="plus" size={16} /> {t('list.memberAdd')}</button>
        </div>
        <button class="ghost danger" onclick={remove}><Icon name="trash" size={16} /> {t('reads.delete')}</button>
      {:else}
        <button class="ghost danger" onclick={leave}>{t('reads.leave')}</button>
      {/if}
    </div>
  </Sheet>
{/if}

<style>
  .back { display: inline-flex; align-items: center; gap: 0.3rem; }
  .head { display: flex; gap: 0.9rem; align-items: flex-start; }
  .head .cv { width: 64px; flex-shrink: 0; }
  .head .cv :global(.cover.sm) { width: 64px; }
  .grow { flex: 1; min-width: 0; }
  .kicker { margin: 0; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  h1 { margin: 0.1rem 0; font-size: 1.35rem; overflow-wrap: anywhere; }
  h1 a { color: var(--text); }
  .note { margin: 0.4rem 0 0; }
  .members { display: grid; gap: 0.55rem; padding: 0.9rem; }
  .member { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(60px, 35%) 3ch; gap: 0.6rem; align-items: center; }
  .nm { overflow-wrap: anywhere; min-width: 0; }
  .bar { height: 6px; border-radius: 3px; background: var(--surface-3); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .pct { text-align: right; color: var(--muted); }
  .compose { display: grid; gap: 0.5rem; padding: 0.9rem; }
  .compose .row { justify-content: space-between; align-items: end; gap: 0.6rem; flex-wrap: wrap; }
  .pos { display: grid; gap: 0.2rem; }
  .pos input { width: 7rem; }
  .compose p { margin: 0; }
  .posts { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
  .post { display: grid; grid-template-columns: 4.2rem minmax(0, 1fr); gap: 0.6rem; align-items: start; }
  .pmark { font-size: 0.78rem; color: var(--accent); font-weight: 600; padding-top: 0.75rem; text-align: right; overflow-wrap: anywhere; }
  .pbody { padding: 0.7rem 0.8rem; display: grid; gap: 0.35rem; }
  .phead { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
  .del { margin-left: auto; }
  .txt { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .lock { margin: 0; display: flex; gap: 0.35rem; align-items: center; font-style: italic; }
  .locked .pbody { border-style: dashed; }
  .mrow { align-items: center; gap: 0.6rem; }
</style>
