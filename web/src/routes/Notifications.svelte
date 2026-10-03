<script lang="ts">
  import { api, ago, type NotificationItem } from '../lib/api.ts';
  import { notifications, toastError } from '../lib/state.svelte.ts';
  import { t, type Key } from '../lib/i18n.svelte.ts';
  import Avatar from '../components/Avatar.svelte';
  import Cover from '../components/Cover.svelte';

  let items = $state<NotificationItem[] | null>(null);

  $effect(() => {
    api.get<{ items: NotificationItem[]; unread: number }>('/notifications')
      .then(async r => {
        items = r.items;
        // Öffnen der Seite = gelesen (die Einträge bleiben hervorgehoben, bis man wiederkommt)
        if (r.unread) notifications.unread = (await api.post<{ unread: number }>('/notifications/read')).unread;
      })
      .catch(toastError);
  });

  const href = (n: NotificationItem) =>
    n.type === 'invite_accepted' ? `/people/${n.actor?.id}` : n.type.startsWith('loan') ? '/loans' : n.book ? `/book/${n.book.id}` : '/';
  const text = (n: NotificationItem) => t(`notif.${n.type}` as Key, { name: n.actor?.displayName ?? '–', title: n.book?.title ?? '' });
</script>

<section class="stack">
  <h1>{t('notif.title')}</h1>
  {#if items === null}
    <div class="spinner"></div>
  {:else if !items.length}
    <p class="empty">{t('notif.none')}</p>
  {:else}
    <div class="list">
      {#each items as n (n.id)}
        <a class="card item" class:new={!n.read} href={href(n)}>
          <Avatar name={n.actor?.displayName ?? '?'} url={n.actor?.avatarUrl} size={40} />
          <div class="body">
            <p>{text(n)}</p>
            <span class="muted small">{ago(n.createdAt)}</span>
          </div>
          {#if n.book}<Cover url={n.book.coverUrl} title={n.book.title} size="sm" />{/if}
        </a>
      {/each}
    </div>
  {/if}
</section>

<style>
  section { max-width: 720px; margin: 0 auto; }
  .list { display: grid; gap: 0.5rem; }
  .item { display: flex; gap: 0.8rem; align-items: center; padding: 0.8rem; color: var(--text); }
  .item:hover { text-decoration: none; border-color: var(--surface-3); }
  .item.new { border-color: var(--accent); background: var(--accent-soft); }
  .body { flex: 1; min-width: 0; }
  .body p { margin: 0 0 0.1rem; }
  .item :global(.cover.sm) { width: 40px; }
</style>
