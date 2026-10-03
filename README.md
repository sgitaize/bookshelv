# bookshelv

**Deine Bibliothek im Freundeskreis.** Bücher und E-Books per ISBN-Scan erfassen, bewerten, kommentieren – und festhalten, wem du welches Buch geliehen hast. Selbst gehostet, schlank, datensparsam.

<p>
  <img alt="Startseite" src="docs/screenshots/home-mobile.png" width="200">
  <img alt="Bibliothek" src="docs/screenshots/library-mobile.png" width="200">
  <img alt="Buchdetail" src="docs/screenshots/book-mobile.png" width="200">
  <img alt="Profil" src="docs/screenshots/profile-mobile.png" width="200">
</p>

## Funktionen

- 📷 **ISBN scannen** mit der Handykamera (native BarcodeDetector-API, Fallback zxing-wasm – läuft auch auf iPhone)
- 🔎 **Suchen** nach Titel/Autor in der **Deutschen Nationalbibliothek** und bei **Open Library**, inkl. Cover
- 📚 **Eigene Bibliothek**: gedruckt (Taschenbuch/Hardcover, Farbschnitt ✦) oder E-Book, private Notizen
- 📖 **Lesestand**: ungelesen / am Lesen / gelesen / abgebrochen, Fortschritt in Seiten oder Prozent, Start- und Enddatum
- 🏠 **Startseite** mit „Lese ich gerade“, „Stapel ungelesener Bücher“, „Zuletzt gelesen“
- ♥ **Profil** mit Favoriten-Regal und Lesezahlen
- 👥 **Freundeskreis**: Regale der anderen ansehen, wer welches Buch hat
- 🔗 **Nur auf Einladung**: jeder Nutzer kann Einladungslinks erzeugen – keine E-Mail-Adresse nötig
- 🛡️ **Admin-Bereich**: Nutzer sperren/löschen, Passwort zurücksetzen, Einladungen verwalten, Katalog aufräumen
- 📱 **PWA**: auf dem Handy wie eine App installierbar
- ⭐ **Bewertungen** mit halben Sternen, Spoiler-Schutz, Kommentare, „Neues aus dem Freundeskreis“
- 🤝 Verleih, 🌐 Föderation, 📴 Offline-Modus – siehe [Roadmap](#roadmap)

## Datenschutz (DSGVO)

- Der Browser spricht **nur mit deinem Server**. Katalogsuchen und Cover laufen über den Server (Proxy) und werden lokal gecacht – DNB/Open Library sehen nie die IP-Adressen deiner Nutzer.
- Keine Google Fonts, kein CDN, kein Tracking, keine Analytics. Schriften und Scanner-WASM werden selbst ausgeliefert.
- Nur ein technisch notwendiges Session-Cookie → kein Cookie-Banner nötig.
- Konten ohne E-Mail-Adresse: nur Benutzername + Passwort (scrypt-gehasht).
- Jeder Nutzer kann **alle eigenen Daten als JSON exportieren** (Art. 15/20) und sein **Konto löschen** (Art. 17).
- Regal-Sichtbarkeit pro Nutzer abschaltbar.

## Technik

| | |
|---|---|
| Backend | Node.js ≥ 22.13, [Hono](https://hono.dev), eingebautes `node:sqlite` – gebündelt zu **einer Datei** ohne `node_modules` |
| Datenbank | SQLite (eine Datei in `data/`) |
| Frontend | Svelte 5 + Vite, PWA |
| Betrieb | Docker, oder Shared Hosting mit Node.js (Plesk/Passenger), oder einfach `node server.js` |

Ressourcenbedarf: ~50 MB RAM, ein paar MB Speicher plus Cover (~30 KB pro Buch).

---

## Selbst hosten

### Variante A: Docker (Homeserver, Raspberry Pi, VPS)

```bash
git clone https://github.com/sgitaize/bookshelv.git
cd bookshelv
docker compose up -d --build
```

Die App läuft dann auf Port `8080`, alle Daten liegen in `./data` (Datenbank + Cover → das ist alles, was du sichern musst).

**Ersteinrichtung:** Beim ersten Start wird ein Einmal-Token erzeugt, damit niemand Fremdes sich zum Admin machen kann:

```bash
cat data/setup-token.txt
```

Öffne die App, gib das Token ein und lege dein Admin-Konto an. Danach lädst du Freunde über **Profil → Freunde einladen** ein.

**HTTPS ist Pflicht** für die Kamera (Browser erlauben `getUserMedia` nur über HTTPS) und für den Login (Secure-Cookie). Hinter einem Reverse Proxy, z. B. mit Caddy:

```caddy
buecher.example.org {
    reverse_proxy localhost:8080
}
```

Nur zum Ausprobieren im LAN ohne HTTPS: `BOOKSHELV_INSECURE_COOKIES: "1"` in der `docker-compose.yml` setzen (Scannen geht dann nicht, Suchen schon).

Für den Raspberry Pi (arm64) baut `docker compose up --build` das Image direkt auf dem Gerät.

### Variante B: Shared Hosting mit Node.js (z. B. netcup Webhosting, Plesk)

Das Backend ist eine einzelne JS-Datei ohne Abhängigkeiten – ideal für Webhosting, auf dem man kein `npm install` ausführen kann.

1. Lokal bauen: `npm install && npm run build` → Ergebnis in `dist/`
2. Inhalt von `dist/` in einen Ordner auf dem Webspace laden, z. B. `bookshelv.example.org/app/`
3. In Plesk unter **Websites & Domains → (Domain) → Node.js**:
   - Node.js-Version: **22 oder neuer**
   - Anwendungsstamm: `/bookshelv.example.org/app`
   - Dokumentstamm: `/bookshelv.example.org/app/public`
   - Anwendungsstartdatei: `server.js`
   - Anwendungsmodus: `production` → **Node.js aktivieren**
4. SSL/TLS-Zertifikat (Let's Encrypt) für die Domain aktivieren
5. Setup-Token aus `app/data/setup-token.txt` lesen (SSH/FTP) und die Seite öffnen

Updates gehen mit dem Deploy-Skript per SSH:

```bash
cp .env.deploy.example .env.deploy   # Host, Benutzer, Zielordner eintragen – wird nicht eingecheckt
npm run deploy                       # baut, lädt hoch, startet neu (data/ bleibt erhalten)
```

### Variante C: direkt mit Node

```bash
npm install && npm run build
cd dist && node server.js            # Port 3000, Daten in dist/data
```

### Konfiguration (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port (unter Passenger ignoriert) |
| `BOOKSHELV_DATA_DIR` | `./data` | Datenbank, Cover, Setup-Token |
| `BOOKSHELV_PUBLIC_DIR` | `./public` | gebautes Frontend |
| `BOOKSHELV_INSECURE_COOKIES` | `0` | `1` = Login auch über http:// (nur zum Testen) |

### Backup

Alles Wichtige liegt in `data/`: `bookshelv.db` (SQLite) und `covers/`. Für ein konsistentes Backup im laufenden Betrieb:

```bash
sqlite3 data/bookshelv.db ".backup data/backup.db"
```

---

## Entwicklung

```bash
npm install
npm run dev        # Backend auf :3000 (mit Watch), Frontend auf :5173 (Vite, Proxy auf das Backend)
```

Im Dev-Modus ohne HTTPS: `BOOKSHELV_INSECURE_COOKIES=1 npm run dev`. Projektstruktur:

```
server/   Backend (TypeScript, Hono, node:sqlite) → esbuild bündelt nach dist/server.js
web/      Frontend (Svelte 5, Vite)               → dist/public
deploy/   Deploy-Skript für Plesk/SSH
docs/     Konzepte (Föderation) und Screenshots
```

## Roadmap

- [x] **Iteration 1** – Konten, Einladungen, Admin, ISBN-Scan, Katalogsuche, Bibliothek, Exemplare (Format/Bindung/Farbschnitt), Lesestand & Fortschritt, Favoriten, Profil
- [x] **Iteration 2** – Reviews (½–5 Sterne + Text, Spoiler, Sichtbarkeit) und Kommentare, „Neues aus dem Freundeskreis“
- [ ] **Iteration 3** – Verleih: an Nutzer oder freie Namen, Rückgabe, „Ich habe gerade geliehen“
- [ ] **Iteration 4** – Feed („Anna fand *Dune* 4/5“), In-App-Benachrichtigungen, Erinnerungen bei langem Verleih
- [ ] **Iteration 5** – **Föderation** zwischen bookshelv-Instanzen für Reviews und Verleih → [Konzept](docs/FEDERATION.md)
- [ ] **Iteration 6** – Import/Export (CSV, Goodreads, StoryGraph), Wunschliste, eigene Cover hochladen
- [ ] **Iteration 7** – Statistiken (Bücher/Seiten pro Monat, Genres, Formate, Autoren, Sterneverteilung) und Jahresrückblick zum Teilen
- [ ] **Iteration 8** – Offline-Modus für die installierte App: Datenstand lokal auf dem Gerät, Lesestand/Bewertungen offline möglich und später synchronisiert, klarer Hinweis „Offline“ mit dem, was gerade nicht geht (z. B. Bücher aus dem Katalog hinzufügen)

## Datenquellen

- [Deutsche Nationalbibliothek](https://www.dnb.de/sru) – Metadaten unter CC0
- [Open Library](https://openlibrary.org/developers/api) – Metadaten und Cover (Internet Archive)
- Cover-Fallback über den DNB/MVB-Coverdienst

## Lizenz

[MIT](LICENSE)
