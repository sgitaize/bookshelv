<script lang="ts">
  import { i18n, t } from '../lib/i18n.svelte.ts';
  import { instance, session } from '../lib/state.svelte.ts';
  // Datenschutzhinweis – beschreibt, was bookshelv selbst speichert. Wer betreibt, steht im verlinkten Impressum.
</script>

<section class="stack prose">
  <h1>{t('privacy.title')}</h1>
  {#if i18n.lang === 'de'}
    <p>Diese bookshelv-Instanz ist eine private Bibliothek für einen Freundeskreis. Verantwortlich ist die Person, die sie betreibt{#if instance.imprintUrl} (siehe <a href={instance.imprintUrl} target="_blank" rel="noopener">Impressum</a>){/if}.</p>
    <h2>Was gespeichert wird</h2>
    <ul>
      <li><b>Konto:</b> Anmeldename, Anzeigename, Passwort (nur als scrypt-Hash), optional ein Profilbild. Keine E-Mail-Adresse, keine Telefonnummer.</li>
      <li><b>Deine Bibliothek:</b> Bücher, Exemplare, Lesestand und -daten, Bewertungen, Kommentare, Listen, Wunschliste, Verleihe und Importe – alles, was du selbst einträgst.</li>
      <li><b>Sitzung:</b> ein technisch notwendiges Cookie (<code>bs_session</code>), damit du angemeldet bleibst. Kein Tracking, keine Werbung, keine Analyse-Dienste.</li>
      <li><b>Auf deinem Gerät:</b> Darstellung, Sprache, zuletzt angemeldetes Konto und Offline-Scans im lokalen Speicher des Browsers.</li>
    </ul>
    <h2>Wer was sieht</h2>
    <p>Mitglieder dieser Instanz sehen dein Regal, Feed-Einträge und Bewertungen, sofern du das nicht in den Einstellungen bzw. pro Bewertung einschränkst. Private Bewertungen und Listen sieht nur du. Ist die Instanz mit anderen bookshelv-Instanzen gekoppelt, gehen nur Bewertungen mit der Sichtbarkeit „Freundeskreis + gekoppelte Instanzen“ und Verleihe an Personen dort hinaus.</p>
    <h2>Externe Dienste</h2>
    <p>Buchdaten und Cover werden <b>vom Server</b> bei der Deutschen Nationalbibliothek und Open Library abgefragt – dein Browser verbindet sich nicht direkt dorthin. Gesendet wird nur die ISBN oder der Suchbegriff. Schriften werden selbst ausgeliefert.</p>
    <h2>Deine Rechte</h2>
    <p>Du kannst jederzeit alle deine Daten exportieren (Einstellungen → Meine Daten) und dein Konto samt Daten löschen. Für alles Weitere wende dich an die Person, die die Instanz betreibt.</p>
  {:else}
    <p>This bookshelv instance is a private library for a circle of friends. It is run by the person who hosts it{#if instance.imprintUrl} (see <a href={instance.imprintUrl} target="_blank" rel="noopener">imprint</a>){/if}.</p>
    <h2>What is stored</h2>
    <ul>
      <li><b>Account:</b> username, display name, password (only as a scrypt hash), optionally a profile picture. No email address, no phone number.</li>
      <li><b>Your library:</b> books, copies, reading status and dates, reviews, comments, lists, wishlist, loans and imports – whatever you enter yourself.</li>
      <li><b>Session:</b> one strictly necessary cookie (<code>bs_session</code>) to keep you signed in. No tracking, no ads, no analytics.</li>
      <li><b>On your device:</b> appearance, language, last signed-in account and offline scans in the browser's local storage.</li>
    </ul>
    <h2>Who sees what</h2>
    <p>Members of this instance can see your shelf, feed entries and reviews unless you restrict that in settings or per review. Private reviews and lists are only visible to you. If the instance is linked with other bookshelv instances, only reviews set to “Friends + linked instances” and loans to people there leave this server.</p>
    <h2>Outside services</h2>
    <p>Book data and covers are looked up <b>by the server</b> at the German National Library and Open Library – your browser never talks to them directly. Only the ISBN or search term is sent. Fonts are served locally.</p>
    <h2>Your rights</h2>
    <p>You can export all your data at any time (Settings → My data) and delete your account along with it. For anything else, contact the person running this instance.</p>
  {/if}
  <a class="btn" href="/">{session.me ? t('app.toShelf') : t('privacy.back')}</a>
</section>

<style>
  .prose { max-width: 720px; margin: 0 auto; padding: 1rem 0 3rem; }
  .prose h2 { font-size: 1.05rem; margin: 0.6rem 0 0; }
  .prose p, .prose li { line-height: 1.6; }
  .prose ul { padding-left: 1.2rem; margin: 0; display: grid; gap: 0.4rem; }
  .prose .btn { justify-self: start; }
</style>
