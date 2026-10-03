<script lang="ts">
  import type { HistoryEvent, HistoryType } from '../lib/api.ts';
  import { t, i18n, fmtDate, type Key } from '../lib/i18n.svelte.ts';
  import Cover from './Cover.svelte';
  import Stars from './Stars.svelte';

  // Zeitachse, nach Monaten gruppiert; compact = ohne Cover (auf der Buchseite)
  let { events, compact = false }: { events: HistoryEvent[]; compact?: boolean } = $props();

  const icon: Record<HistoryType, string> = {
    added: '＋', removed: '－', started: '▶', finished: '✓', dnf: '■', reviewed: '★',
    lent: '→', got_back: '↩', borrowed: '←', gave_back: '↪'
  };

  const groups = $derived.by(() => {
    const out: { month: string; items: HistoryEvent[] }[] = [];
    for (const e of events) {
      const month = new Date(e.date + 'T12:00:00').toLocaleDateString(i18n.locale, { month: 'long', year: 'numeric' });
      if (out.at(-1)?.month !== month) out.push({ month, items: [] });
      out.at(-1)!.items.push(e);
    }
    return out;
  });

  const label = (e: HistoryEvent) => e.type === 'removed' && e.reason && e.reason !== 'other'
    ? t(`hist.removed.${e.reason}` as Key)
    : t(`hist.${e.type}` as Key, { name: e.person ?? '–' });
</script>

<div class="timeline" class:compact>
  {#each groups as g (g.month)}
    <h3 class="month">{g.month}</h3>
    <ol>
      {#each g.items as e, i (i + e.type + e.date + e.book.id)}
        <li class="ev {e.type}">
          <span class="dot" aria-hidden="true">{icon[e.type]}</span>
          {#if !compact}
            <a href="/book/{e.book.id}" class="cv"><Cover url={e.book.coverUrl} title={e.book.title} authors={e.book.authors} size="sm" /></a>
          {/if}
          <div class="body">
            <span class="what">{label(e)}{#if e.rating} <Stars value={e.rating} size={13} />{/if}</span>
            {#if !compact}<a href="/book/{e.book.id}" class="title">{e.book.title}</a>{/if}
            <span class="muted small">{fmtDate(e.date)}{#if e.dueAt} · {t('hist.due', { d: fmtDate(e.dueAt) })}{/if}</span>
          </div>
        </li>
      {/each}
    </ol>
  {/each}
</div>

<style>
  .month { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 1.2rem 0 0.5rem; }
  .month:first-child { margin-top: 0; }
  ol { list-style: none; margin: 0; padding: 0 0 0 0.9rem; border-left: 2px solid var(--line); display: grid; gap: 0.7rem; }
  .ev { position: relative; display: flex; gap: 0.8rem; align-items: center; padding-left: 0.9rem; }
  .dot {
    position: absolute; left: calc(-0.9rem - 13px); top: 50%; translate: 0 -50%;
    width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
    font-size: 0.75rem; font-weight: 700; background: var(--surface-2); border: 2px solid var(--bg); color: var(--muted);
  }
  .finished .dot, .got_back .dot, .gave_back .dot { background: var(--ok); color: #fff; }
  .lent .dot, .borrowed .dot { background: var(--accent); color: var(--accent-ink); }
  .reviewed .dot { background: var(--star); color: #3a2a00; }
  .started .dot { background: var(--accent-soft); color: var(--accent); }
  .removed .dot, .dnf .dot { background: var(--surface-3); }
  .body { display: grid; min-width: 0; line-height: 1.35; }
  .what { font-weight: 500; display: inline-flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .title { color: var(--text); font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .compact ol { gap: 0.5rem; }
</style>
