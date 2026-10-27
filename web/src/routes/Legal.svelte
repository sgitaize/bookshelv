<script lang="ts">
  import { brandHost } from '../lib/app.svelte.ts';
  import { api } from '../lib/api.ts';
  import { i18n, t } from '../lib/i18n.svelte.ts';
  import { session } from '../lib/state.svelte.ts';

  /**
   * Impressum + Datenschutzerklärung, erzeugt aus den Angaben der betreibenden Person (Admin → Instanz).
   * Aufbau wie bei „Letzte Runde“; der Text beschreibt, was bookshelv tatsächlich verarbeitet.
   */
  type Operator = { name?: string; org?: string; street?: string; city?: string; email?: string; phone?: string; website?: string; hoster?: string; authority?: string };
  let legal = $state<{ imprintUrl: string | null; operator: Operator; googleBooks?: boolean } | null>(null);
  $effect(() => {
    api.get<typeof legal>('/legal').then(r => {
      legal = r;
      // Sprungmarke (#impressum / #datenschutz) erst nach dem Rendern anspringen
      requestAnimationFrame(() => { if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView(); });
    }).catch(() => (legal = { imprintUrl: null, operator: {} }));
  });
  const op = $derived(legal?.operator ?? {});
  const de = $derived(i18n.lang === 'de');
  const tel = (p: string) => 'tel:' + p.replace(/[^\d+]/g, '');
  const host = brandHost();
</script>

{#snippet address()}
  {op.name}{#if op.org}<br />{op.org}{/if}{#if op.street}<br />{op.street}{/if}{#if op.city}<br />{op.city}{/if}
{/snippet}
{#snippet contact()}
  {#if op.phone}{de ? 'Telefon' : 'Phone'}: <a href={tel(op.phone)}>{op.phone}</a><br />{/if}
  {#if op.email}{de ? 'E-Mail' : 'Email'}: <a href="mailto:{op.email}">{op.email}</a>{/if}
{/snippet}

<section class="legal">
  <a class="back" href="/">← {session.me ? t('app.toShelf') : t('privacy.back')}</a>
  <h1>bookshelv – {de ? 'Impressum & Datenschutz' : 'Imprint & Privacy'}</h1>

  {#if !legal}
    <div class="spinner"></div>
  {:else}
    <div class="card" id="impressum">
      <h2>{de ? 'Impressum' : 'Imprint'}</h2>
      {#if op.name}
        <p>{de ? 'Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)' : 'Information pursuant to § 5 German Digital Services Act (DDG)'}</p>
        <p>{@render address()}</p>
        {#if op.phone || op.email}<h3>{de ? 'Kontakt' : 'Contact'}</h3><p>{@render contact()}</p>{/if}
        <h3>{de ? 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV' : 'Responsible for content under § 18 (2) MStV'}</h3>
        <p>{op.name}, {de ? 'Anschrift wie oben' : 'address as above'}</p>
        {#if op.website}<h3>{de ? 'Mehr von mir' : 'More from me'}</h3><p>{de ? 'Weitere Projekte und wer ich bin:' : 'Other projects and who I am:'} <a href={op.website} target="_blank" rel="noopener">{op.website.replace(/^https?:\/\//, '')}</a></p>{/if}
        <h3>{de ? 'Verbraucherstreitbeilegung' : 'Consumer dispute resolution'}</h3>
        <p>{de ? 'Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.' : 'We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.'}</p>
        <p class="muted">{de
          ? `bookshelv auf ${host} ist eine private, kostenlose Bibliothek für einen Freundeskreis – nicht-kommerziell, ohne Werbung, Registrierung nur per Einladung.`
          : `bookshelv on ${host} is a private, free library for a circle of friends – non-commercial, no ads, sign-up by invitation only.`}</p>
      {:else if legal.imprintUrl}
        <p>{de ? 'Das Impressum der betreibenden Person findest du hier:' : 'The operator’s imprint is here:'} <a href={legal.imprintUrl} target="_blank" rel="noopener">{legal.imprintUrl}</a></p>
      {:else}
        <p class="muted">{de ? 'Die betreibende Person hat noch keine Angaben hinterlegt (Admin → Instanz).' : 'The operator has not entered any details yet (Admin → Instance).'}</p>
      {/if}
    </div>

    <div class="card" id="datenschutz">
      {#if de}
        <h2>Datenschutzerklärung</h2>
        <h3>Verantwortlich</h3>
        {#if op.name}
          <p>{op.name}{#if op.org}, {op.org}{/if}{#if op.street}, {op.street}{/if}{#if op.city}, {op.city}{/if}{#if op.email}, <a href="mailto:{op.email}">{op.email}</a>{/if}</p>
        {:else}
          <p>Die Person, die diese bookshelv-Instanz betreibt{#if legal.imprintUrl} (siehe <a href={legal.imprintUrl} target="_blank" rel="noopener">Impressum</a>){/if}.</p>
        {/if}

        <h3>Kurz gesagt</h3>
        <ul>
          <li>Eine private Bibliothek für einen Freundeskreis: Mitmachen nur per Einladungslink, keine E-Mail-Adresse, keine Telefonnummer.</li>
          <li>Ein einziges, technisch notwendiges Cookie für die Anmeldung. Kein Tracking, keine Werbung, keine Analyse-Dienste.</li>
          <li>Gespeichert wird, was du selbst einträgst. Du kannst alles exportieren und dein Konto jederzeit samt Daten löschen.</li>
        </ul>

        <h3>Hosting und Server-Protokolle</h3>
        <p>Die Seite läuft {op.hoster ? `bei ${op.hoster} als Auftragsverarbeiter` : 'auf einem Server, den die betreibende Person verwaltet'}. Beim Aufruf verarbeitet der Webserver technisch notwendige Daten wie IP-Adresse, Zeitpunkt, aufgerufene Adresse und Browser-Kennung in Protokolldateien des Hosters, um die Seite auszuliefern und vor Missbrauch zu schützen. bookshelv selbst hält IP-Adressen nur kurzzeitig im Arbeitsspeicher, um wiederholte Fehlanmeldungen zu bremsen, und speichert sie nicht dauerhaft. Rechtsgrundlage: berechtigtes Interesse an einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).</p>

        <h3>Konto</h3>
        <p>Für dein Konto speichern wir Anmeldename, Anzeigename, dein Passwort (nur als scrypt-Hash, nie im Klartext), optional ein Profilbild, deine Einstellungen (z. B. Farbthema, Schrift, voreingestellte Sichtbarkeit von Bewertungen) und von wem deine Einladung stammt. Rechtsgrundlage: Bereitstellung des Dienstes, den du nutzen möchtest (Art. 6 Abs. 1 lit. b DSGVO).</p>

        <h3>Deine Bibliothek</h3>
        <p>Gespeichert wird, was du einträgst: Bücher und Exemplare, Lesestand und -daten, Bewertungen mit Text, Stimmung und Tempo, Kommentare, Leselisten, Top 5, Wunschliste, Verleihe und Importe. Bei einem Import lädt deine App die Einträge aus der Datei hoch; der Server arbeitet sie im Hintergrund ab und merkt sich die Änderungen, damit du den Import rückgängig machen kannst. Benachrichtigungen (z. B. Verleih-Erinnerungen) entstehen aus diesen Daten und werden nach den letzten 200 je Konto gelöscht.</p>
        <h3>Wer was sieht</h3>
        <p>Andere Mitglieder dieser Instanz sehen dein Regal, deine Feed-Einträge (angefangen, gelesen, bewertet …), Bewertungen und öffentlichen Listen – außer du stellst dein Regal in den Einstellungen auf privat oder wählst bei einer Bewertung „Nur ich“. Private Listen und private Bewertungen sieht nur du. Verleihst du ein Buch an jemanden ohne Konto, siehst nur du den eingetragenen Namen – trag deshalb bitte nur ein, was du zur Erinnerung brauchst.</p>

        <h3>Gekoppelte Instanzen (Föderation)</h3>
        <p>Ist diese Instanz mit anderen bookshelv-Instanzen gekoppelt, werden nur Bewertungen mit der Sichtbarkeit „Freundeskreis + gekoppelte Instanzen“ (mit deinem Anmelde- und Anzeigenamen) sowie Verleihe an Personen dort an die andere Instanz übertragen. Die Verbindung ist signiert und läuft nur zwischen den Servern. Für die Verarbeitung dort ist die Person verantwortlich, die die andere Instanz betreibt. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</p>

        <h3>Buchdaten und Cover</h3>
        <p>Buchdaten und Cover stammen von der Deutschen Nationalbibliothek, von Open Library (Internet Archive, USA) und vom Katalog K10plus (Verbundzentrale des GBV, Göttingen){#if legal?.googleBooks}, auf dieser Instanz zusätzlich von Google Books (Google, USA) – Google fragt immer nur der Server an, nie dein Browser oder die App{/if}. Übermittelt werden nur ISBN bzw. Suchbegriff, nie dein Konto oder deine IP-Adresse.</p>
        <p><b>Im Browser</b> fragt <b>der Server</b> diese Kataloge für dich an – sie sehen also nicht deine IP-Adresse. Cover werden auf dem Server zwischengespeichert. Dein Browser verbindet sich mit keinem fremden Dienst; auch die Schriften werden von hier ausgeliefert.</p>
        <p><b>In der App</b> (iPhone, iPad, Android) sucht dein Gerät selbst in den Katalogen und lädt die Vorschaubilder der Treffer direkt – das ist schneller und entlastet den Server. Dabei sehen die Kataloge die IP-Adresse deines Geräts. Mit Konto fragt die App gleichzeitig den Server {#if legal?.googleBooks}(der auch Google Books einbezieht) {/if}und zeigt die schnellere Antwort; der Server bekommt dafür den Suchbegriff und die ISBNs der Treffer, damit er dir auch Bücher zeigen kann, die in dieser Instanz schon erfasst sind, und wer im Freundeskreis sie hat. Übernimmst du ein Buch in dein Konto, schlägt der Server die ISBN nach und speichert das Cover.</p>

        <h3>Cookies und Speicher im Browser</h3>
        <p>Für die Anmeldung setzen wir ein Sitzungs-Cookie (<code>bs_session</code>, gültig bis zu 60 Tage oder bis du dich abmeldest). Außerdem speichert dein Browser lokal Farbthema, Schrift und Sprache, dein zuletzt angemeldetes Konto (damit die App auch offline startet), offline gescannte ISBNs und offline vorgemerkte Änderungen sowie die zuletzt geladenen Seiten und Dateien der App (Service Worker), damit sie ohne Netz funktioniert. Das ist für den von dir gewünschten Dienst technisch erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG) – ein Cookie-Banner ist deshalb nicht nötig. Beim Abmelden wird der Zwischenspeicher geleert; den Rest kannst du über die Browser-Einstellungen („Website-Daten löschen“) entfernen.</p>

        <h3>Kamera</h3>
        <p>Der ISBN-Scanner nutzt die Kamera nur, wenn du ihn öffnest und den Zugriff im Browser erlaubst. Das Bild wird ausschließlich auf deinem Gerät ausgewertet und nicht übertragen.</p>

        <h3>Die App für iPhone, iPad und Android</h3>
        <p><b>Ohne Konto</b> (Standard) liegt deine Bibliothek ausschließlich auf deinem Gerät; wir erhalten davon nichts. Buchdaten und Cover fragt die App dann <b>direkt</b> bei den Katalogen an (siehe „Buchdaten und Cover“). Die Sicherung speichert die App in <b>deiner eigenen iCloud</b> (Apple) bzw. in der <b>Google-Sicherung deines Android-Geräts</b> oder dort, wohin du sie exportierst – wir haben darauf keinen Zugriff.</p>
        <p><b>Mit Konto</b> gilt für deine Daten diese Erklärung der jeweiligen Instanz. Die App merkt sich die Anmeldung auf dem Gerät und hält eine Kopie deiner Bibliothek für unterwegs vor. Die Kamera nutzt der Scanner nur auf dem Gerät. Trinkgelder laufen über Apple bzw. Google Play (In-App-Kauf); wir erhalten dabei keine persönlichen Daten. Die App enthält keine Werbung und keine Tracking-Dienste.</p>
        <p><b>Barcode-Scanner unter Android:</b> Die Android-App erkennt Barcodes mit Google ML Kit. Die Erkennung läuft vollständig auf dem Gerät; Kamerabilder und gescannte ISBNs verlassen es nicht. ML Kit sendet aber technische Diagnosedaten an Google (z. B. Gerätemodell, Android- und App-Version, Leistungswerte, Fehlercodes) und verwendet dafür eine Kennung je Installation, die weder dich noch dein Gerät eindeutig identifiziert. Google nutzt diese Daten, um ML Kit zu betreiben und zu verbessern, und gibt sie nicht an Dritte weiter (<a href="https://developers.google.com/ml-kit/android-data-disclosure" target="_blank" rel="noopener">Angaben von Google</a>). Rechtsgrundlage ist unser berechtigtes Interesse an einem zuverlässigen Scanner (Art. 6 Abs. 1 lit. f DSGVO). Unter iOS nutzt die App den Scanner von Apple (VisionKit) ohne solche Übermittlung.</p>

        <h3>Speicherdauer und Löschen</h3>
        <p>Deine Daten bleiben gespeichert, solange dein Konto besteht. Unter Einstellungen → Meine Daten kannst du alles exportieren (JSON/CSV) und dein Konto löschen; dabei werden deine Daten und dein Profilbild entfernt, Verleihe an dich bleiben bei der verleihenden Person als „gelöschtes Konto“ stehen. Sicherungskopien der Datenbank werden nur für kurze Zeit aufbewahrt und dann überschrieben.</p>

        <h3>Deine Rechte</h3>
        <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch (Art. 15–21 DSGVO). Wende dich dazu an {op.email ? '' : 'die betreibende Person'}{#if op.email}<a href="mailto:{op.email}">{op.email}</a>{/if}. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren{op.authority ? `, z. B. beim ${op.authority}` : ''}.</p>
        <p class="muted">Stand: Oktober 2026</p>
      {:else}
        <h2>Privacy policy</h2>
        <h3>Controller</h3>
        {#if op.name}
          <p>{op.name}{#if op.org}, {op.org}{/if}{#if op.street}, {op.street}{/if}{#if op.city}, {op.city}{/if}{#if op.email}, <a href="mailto:{op.email}">{op.email}</a>{/if}</p>
        {:else}
          <p>The person running this bookshelv instance{#if legal.imprintUrl} (see <a href={legal.imprintUrl} target="_blank" rel="noopener">imprint</a>){/if}.</p>
        {/if}
        <h3>In short</h3>
        <ul>
          <li>A private library for a circle of friends: invitation only, no email address, no phone number.</li>
          <li>One strictly necessary cookie for signing in. No tracking, no ads, no analytics.</li>
          <li>We store what you enter. You can export everything and delete your account with all its data at any time.</li>
        </ul>
        <h3>Hosting and server logs</h3>
        <p>The site runs {op.hoster ? `at ${op.hoster} as a processor` : 'on a server managed by the operator'}. The web server processes technically necessary data such as IP address, time, requested URL and user agent in the host’s log files to deliver the site and protect it from abuse. bookshelv itself only keeps IP addresses in memory briefly to slow down repeated failed sign-ins and does not store them. Legal basis: legitimate interest in secure operation (Art. 6 (1) (f) GDPR).</p>
        <h3>Account</h3>
        <p>For your account we store username, display name, your password (only as a scrypt hash), optionally a profile picture, your settings and who invited you. Legal basis: providing the service you want to use (Art. 6 (1) (b) GDPR).</p>
        <h3>Your library</h3>
        <p>We store what you enter: books and copies, reading status and dates, reviews with text, mood and pace, comments, reading lists, top 5, wishlist, loans and imports. For an import, your app uploads the entries from the file; the server processes them in the background and records the changes so you can undo the import. Notifications are derived from this data; only the latest 200 per account are kept.</p>
        <h3>Who sees what</h3>
        <p>Other members of this instance can see your shelf, feed entries, reviews and public lists – unless you make your shelf private in settings or choose “Only me” for a review. Private lists and reviews are only visible to you. If you lend a book to someone without an account, only you see the name you entered.</p>
        <h3>Linked instances (federation)</h3>
        <p>If this instance is linked with other bookshelv instances, only reviews set to “Friends + linked instances” (with your username and display name) and loans to people there are sent to the other instance, signed and server to server. The operator of the other instance is responsible for processing there. Legal basis: Art. 6 (1) (b) GDPR.</p>
        <h3>Book data and covers</h3>
        <p>Book data and covers come from the German National Library, Open Library (Internet Archive, USA) and the K10plus catalogue (Verbundzentrale des GBV, Göttingen, Germany){#if legal?.googleBooks}, and on this instance also from Google Books (Google, USA) – Google is only ever queried by the server, never by your browser or the app{/if}. Only the ISBN or search term is sent, never your account or IP address.</p>
        <p><b>In the browser</b>, <b>the server</b> queries these catalogues for you, so they don't see your IP address. Covers are cached on the server. Your browser does not contact any third-party service; fonts are served from here as well.</p>
        <p><b>In the app</b> (iPhone, iPad, Android) your device searches the catalogues itself and loads the preview images of the results directly – that is faster and takes load off the server. The catalogues see your device's IP address. With an account the app asks the server at the same time {#if legal?.googleBooks}(which also includes Google Books){/if} and shows whichever answers first; for this the server receives the search term and the ISBNs of the results, so it can also show you books already recorded on this instance and which friends own them. When you add a book to your account, the server looks up the ISBN and stores the cover.</p>
        <h3>Cookies and browser storage</h3>
        <p>For signing in we set one session cookie (<code>bs_session</code>, valid for up to 60 days or until you sign out). Your browser also stores theme, font and language, your last signed-in account (so the app starts offline), offline scans and queued changes, and the most recently loaded pages and app files (service worker) so it works without a connection. This is strictly necessary for the service you requested (§ 25 (2) no. 2 TDDDG), so no cookie banner is needed. Signing out clears the cache; everything else can be removed in your browser settings.</p>
        <h3>Camera</h3>
        <p>The ISBN scanner only uses the camera when you open it and allow access. The image is analysed on your device only and never uploaded.</p>
        <h3>The app for iPhone, iPad and Android</h3>
        <p><b>Without an account</b> (the default) your library is stored only on your device; we receive nothing. The app then asks the catalogues <b>directly</b> for book data and covers (see “Book data and covers”). Backups go to <b>your own iCloud</b> (Apple), your <b>Android device's Google backup</b> or wherever you export them – we have no access.</p>
        <p><b>With an account</b> the privacy policy of that instance applies. The app remembers your sign-in on the device and keeps a copy of your library for offline use. The scanner uses the camera on the device only. Tips are processed by Apple or Google Play (in-app purchase); we receive no personal data. The app contains no ads and no tracking.</p>
        <p><b>Barcode scanner on Android:</b> The Android app recognises barcodes with Google ML Kit. Recognition runs entirely on the device; camera images and scanned ISBNs never leave it. ML Kit does send technical diagnostics to Google (e.g. device model, Android and app version, performance metrics, error codes) using a per-installation identifier that does not uniquely identify you or your device. Google uses this data to operate and improve ML Kit and does not share it with third parties (<a href="https://developers.google.com/ml-kit/android-data-disclosure" target="_blank" rel="noopener">Google's disclosure</a>). The legal basis is our legitimate interest in a reliable scanner (Art. 6(1)(f) GDPR). On iOS the app uses Apple's scanner (VisionKit) without any such transfer.</p>
        <h3>Retention and deletion</h3>
        <p>Your data is kept as long as your account exists. Under Settings → My data you can export everything (JSON/CSV) and delete your account, which removes your data and profile picture; loans to you remain with the lender as “deleted account”. Database backups are kept only briefly and then overwritten.</p>
        <h3>Your rights</h3>
        <p>You have the right of access, rectification, erasure, restriction of processing, data portability and objection (Art. 15–21 GDPR). Contact {op.email ? '' : 'the operator'}{#if op.email}<a href="mailto:{op.email}">{op.email}</a>{/if}. You may also lodge a complaint with a data protection supervisory authority{op.authority ? `, e.g. the ${op.authority}` : ''}.</p>
        <p class="muted">Last updated: October 2026</p>
      {/if}
    </div>
    <a class="back" href="/">← {session.me ? t('app.toShelf') : t('privacy.back')}</a>
  {/if}
</section>

<style>
  .legal { max-width: 760px; margin: 0 auto; padding: 1rem 0 3rem; display: grid; gap: 0.9rem; }
  .legal h1 { font-size: 1.4rem; margin: 0.2rem 0; }
  .legal .card { padding: 1rem 1.2rem; scroll-margin-top: 5rem; }
  .legal h2 { font-size: 1.15rem; margin: 0 0 0.4rem; }
  .legal h3 { font-size: 0.98rem; margin: 1rem 0 0.2rem; }
  .legal p, .legal li { line-height: 1.6; margin: 0.35rem 0; overflow-wrap: anywhere; }
  .legal ul { padding-left: 1.2rem; margin: 0.3rem 0; }
  .back { justify-self: start; }
</style>
