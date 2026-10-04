<script lang="ts">
  import { api, ago, type NotificationItem } from '../lib/api.ts';
  import { notifications, toastError } from '../lib/state.svelte.ts';
  import { t, type Key } from '../lib/i18n.svelte.ts';
  import Avatar from '../components/Avatar.svelte';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';
  import { pending, net, writes } from '../lib/offline.svelte.ts';

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
    n.type === 'import_done' ? '/imports' : n.type === 'list_shared' ? `/lists/${n.refId}` : n.type === 'invite_accepted' ? `/people/${n.actor?.id}` : n.type === 'loan_request' ? '/loans?tab=requests' : n.type === 'loan_declined' && n.book ? `/book/${n.book.id}` : n.type.startsWith('loan') ? '/loans' : n.type === 'wish_available' && n.book ? `/book/${n.book.id}` : n.book ? `/book/${n.book.id}` : '/';
  const text = (n: NotificationItem) => t(`notif.${n.type}` as Key, { name: n.actor?.displayName ?? '–', title: n.book?.title ?? n.list?.name ?? '' });
</script>

<section class="stack">
  <h1>{t('notif.title')}</h1>
  {#if pending.items.length}
    <a class="card item todo" href="/add">
      <span class="ico"><Icon name="scan" size={20} /></span>
      <div class="body">
        <p>{t('notif.pendingScans', { n: pending.items.length })}</p>
        <span class="muted small">{net.online ? t('notif.pendingScansGo') : t('notif.pendingScansOffline')}</span>
      </div>
    </a>
  {/if}
  {#if writes.items.length}
    <div class="card item todo">
      <span class="ico"><Icon name="activity" size={20} /></span>
      <div class="body">
        <p>{t('notif.queuedWrites', { n: writes.items.length })}</p>
        <span class="muted small">{t('notif.queuedWritesInfo')}</span>
      </div>
    </div>
  {/if}
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
  .todo { border-color: var(--accent); }
  .ico { width: 40px; height: 40px; flex: none; display: grid; place-items: center; border-radius: 999px; background: var(--surface-2); color: var(--accent); }
</style>
