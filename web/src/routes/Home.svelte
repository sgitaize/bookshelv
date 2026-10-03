<script lang="ts">
  import { api, percent, type Home, type ReadingItem } from '../lib/api.ts';
  import { session, toastError } from '../lib/state.svelte.ts';
  import Cover from '../components/Cover.svelte';
  import Icon from '../components/Icon.svelte';
  import ProgressSheet from '../components/ProgressSheet.svelte';

  let home = $state<Home | null>(null);
  let editing = $state<ReadingItem | null>(null);

  const load = () => api.get<Home>('/home').then(r => (home = r)).catch(toastError);
  $effect(() => { load(); });

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend';
  })();
</script>

{#if !home}
  <div class="spinner"></div>
{:else}
  <section class="hello">
    <h1>{greeting}, {session.me?.displayName}</h1>
    <div class="stats">
      <a href="/library"><b>{home.counts.books}</b><span>im Regal</span></a>
      <span class="div"></span>
      <a href="/library?filter=read"><b>{home.counts.readThisYear}</b><span>gelesen {new Date().getFullYear()}</span></a>
      <span class="div"></span>
      <a href="/library?filter=unread"><b>{home.toReadCount}</b><span>ungelesen</span></a>
    </div>
  </section>

  {#if home.counts.books === 0 && !home.reading.length}
    <div class="empty card">
      <h2>Willkommen bei bookshelv!</h2>
      <p>Scanne den Barcode auf der Rückseite eines Buchs oder such es nach Titel – so füllst du dein Regal.</p>
      <a href="/add" class="btn primary"><Icon name="scan" size={18} /> Erstes Buch hinzufügen</a>
    </div>
  {/if}

  {#if home.reading.length}
    <section class="current">
      <h2 class="center-title">Lese ich gerade ({home.reading.length})</h2>
      <div class="book-row centered">
        {#each home.reading as r (r.book.id)}
          {@const pct = percent(r.progress, r.book.pages)}
          <div class="reading">
            <a href="/book/{r.book.id}"><Cover url={r.book.coverUrl} title={r.book.title} authors={r.book.authors} /></a>
            <div class="prog">
              <button class="bar" onclick={() => (editing = r)} aria-label="Fortschritt eintragen">
                <span class="fill" style="width: {Math.max(pct, 4)}%"></span>
                <span class="pct">{pct}%</span>
              </button>
              <button class="icon ghost pen" onclick={() => (editing = r)} aria-label="Fortschritt bearbeiten"><Icon name="edit" size={16} /></button>
            </div>
          </div>
        {/each}
      </div>
    </section>
    <hr class="sep" />
  {/if}

  {#if home.toRead.length}
    <section>
      <div class="section-head">
        <h2>Stapel ungelesener Bücher ({home.toReadCount})</h2>
        <a href="/library?filter=unread" aria-label="Alle ungelesenen"><Icon name="arrow" /></a>
      </div>
      <div class="book-row">
        {#each home.toRead as it (it.id)}
          <a href="/book/{it.book.id}"><Cover url={it.book.coverUrl} title={it.book.title} authors={it.book.authors} /></a>
        {/each}
      </div>
    </section>
  {/if}

  {#if home.recentlyRead.length}
    <section>
      <div class="section-head">
        <h2>Zuletzt gelesen</h2>
        <a href="/library?filter=read" aria-label="Alle gelesenen"><Icon name="arrow" /></a>
      </div>
      <div class="book-row">
        {#each home.recentlyRead as r (r.book.id)}
          <a href="/book/{r.book.id}"><Cover url={r.book.coverUrl} title={r.book.title} authors={r.book.authors} /></a>
        {/each}
      </div>
    </section>
  {/if}

  {#if home.recentlyAdded.length}
    <section>
      <div class="section-head">
        <h2>Neu im Regal</h2>
        <a href="/library" aria-label="Ganze Bibliothek"><Icon name="arrow" /></a>
      </div>
      <div class="book-row">
        {#each home.recentlyAdded as it (it.id)}
          <a href="/book/{it.book.id}"><Cover url={it.book.coverUrl} title={it.book.title} authors={it.book.authors} /></a>
        {/each}
      </div>
    </section>
  {/if}
{/if}

<ProgressSheet item={editing} onclose={() => (editing = null)} onsaved={load} />

<style>
  .hello { text-align: center; padding: 0.6rem 0 1.4rem; }
  .hello h1 { font-size: 1.35rem; margin-bottom: 1rem; }
  .stats {
    display: flex; align-items: center; justify-content: space-around;
    border: 1px solid var(--line); border-radius: 8px; padding: 0.9rem 0.5rem; max-width: 460px; margin: 0 auto;
  }
  .stats a { display: grid; justify-items: center; color: var(--text); flex: 1; }
  .stats a:hover { text-decoration: none; }
  .stats b { font-size: 1.3rem; font-weight: 600; color: var(--accent); }
  .stats span { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .stats .div { width: 1px; align-self: stretch; background: var(--line); flex: none; }
  .center-title { text-align: center; color: var(--accent); margin-bottom: 1rem; }
  .book-row.centered { justify-content: safe center; }
  .reading { display: grid; gap: 0.5rem; flex-basis: 104px !important; }
  .prog { display: flex; align-items: center; gap: 0.2rem; }
  .bar {
    position: relative; flex: 1; height: 22px; padding: 0; border: none; border-radius: 6px;
    background: var(--surface-3); overflow: hidden; display: block;
  }
  .fill { position: absolute; inset: 0 auto 0 0; background: var(--progress); border-radius: 6px; }
  .pct { position: relative; font-size: 0.72rem; font-weight: 600; color: var(--text); padding-left: 6px; line-height: 22px; display: block; text-align: left; }
  .pen { padding: 0.25rem; color: var(--muted); }
  section { margin-bottom: 1.6rem; }
</style>
