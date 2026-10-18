<script lang="ts">
  // Inhaltshinweise auf der Buchseite: Schlagworte mit Anzahl, Texte von mir und Freund*innen, eigene Hinweise bearbeiten
  import { api, NOTE_TAGS, type ContentNotes } from '../lib/api.ts';
  import { t, tn, type Key } from '../lib/i18n.svelte.ts';
  import { toastError, avoid } from '../lib/state.svelte.ts';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';

  let { bookId, coverUrl }: { bookId: number; coverUrl: string | null } = $props();

  let data = $state<ContentNotes | null>(null);
  let open = $state(false);
  let tags = $state<string[]>([]);
  let note = $state('');
  let busy = $state(false);
  let showAll = $state(false);

  $effect(() => { api.get<ContentNotes>(`/books/${bookId}/content-notes`).then(r => (data = r)).catch(() => {}); });

  const tagName = (x: string) => t(`cn.${x}` as Key);
  const toggle = (x: string) => (tags = tags.includes(x) ? tags.filter(y => y !== x) : [...tags, x]);
  const coverHidden = $derived(!!coverUrl && avoid.covers.includes(coverUrl) && !avoid.revealed.includes(coverUrl));

  function edit() {
    tags = [...(data?.mine?.tags ?? [])];
    note = data?.mine?.note ?? '';
    open = true;
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      data = await api.put<ContentNotes>(`/books/${bookId}/content-notes`, { tags, note });
      open = false;
    } catch (err) { toastError(err); } finally { busy = false; }
  }
</script>

{#if data}
  <section class="stack cn">
    <div class="spread">
      <h2>{t('cn.title')}</h2>
      <button class="small ghost" onclick={edit}><Icon name={data.mine ? 'edit' : 'plus'} size={14} /> {data.mine ? t('cn.editMine') : t('cn.add')}</button>
    </div>
    {#if data.avoided.length}
      <div class="card warn">
        <Icon name="shield" size={18} />
        <div class="grow">
          <p>{t('cn.avoidedHint', { tags: data.avoided.map(tagName).join(', ') })}</p>
          {#if coverHidden}<button class="small" onclick={() => avoid.revealed.push(coverUrl!)}>{t('cn.showCover')}</button>{/if}
        </div>
      </div>
    {/if}
    {#if data.tags.length}
      <div class="tags">
        {#each showAll ? data.tags : data.tags.slice(0, 8) as x (x.tag)}
          <span class="chip" class:avoided={data.avoided.includes(x.tag)} class:mine={x.mine}>{tagName(x.tag)}{#if x.n > 1} · {x.n}{/if}</span>
        {/each}
        {#if data.tags.length > 8 && !showAll}<button class="link small" onclick={() => (showAll = true)}>{t('cn.more', { n: data.tags.length - 8 })}</button>{/if}
      </div>
      <p class="muted small">{tn('cn.from', data.people)}</p>
    {:else}
      <p class="muted small">{t('cn.none')}</p>
    {/if}
    {#each data.notes as n (n.user.id)}
      <div class="note">
        <Avatar name={n.user.displayName} url={n.user.avatarUrl} size={24} />
        <p><b>{n.mine ? t('cn.you') : n.user.displayName}:</b> {n.text}</p>
      </div>
    {/each}
  </section>
{/if}

<Sheet {open} onclose={() => (open = false)} title={t('cn.title')}>
  <form class="stack" onsubmit={save}>
    <p class="muted small">{t('cn.info')}</p>
    <div class="chips">
      {#each NOTE_TAGS as x}<button type="button" class:active={tags.includes(x)} aria-pressed={tags.includes(x)} onclick={() => toggle(x)}>{tagName(x)}</button>{/each}
    </div>
    <label class="field"><span>{t('cn.noteLabel')}</span>
      <textarea bind:value={note} rows="3" maxlength="500" placeholder={t('cn.notePh')}></textarea>
    </label>
    <button class="primary" disabled={busy}>{t('common.save')}</button>
  </form>
</Sheet>

<style>
  .cn { margin: 1.4rem 0; }
  .tags { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
  .chip.avoided { background: color-mix(in srgb, var(--danger) 25%, transparent); color: var(--text); }
  .chip.mine { outline: 1px solid var(--accent); }
  .warn { display: flex; gap: 0.7rem; align-items: flex-start; border-color: color-mix(in srgb, var(--danger) 50%, transparent); }
  .warn p { margin: 0 0 0.4rem; }
  .grow { flex: 1; }
  .note { display: flex; gap: 0.5rem; align-items: flex-start; }
  .note p { margin: 0; font-size: 0.9rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chips button { font-size: 0.8rem; padding: 0.3em 0.75em; border-radius: 999px; white-space: normal; }
  .chips button.active { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
</style>
