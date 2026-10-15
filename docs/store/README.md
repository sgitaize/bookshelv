# Store-Material (App Store + Android-Download)

| Was | Wo |
|---|---|
| Texte DE/EN, Kategorie, Altersfreigabe, Review-Notizen | [metadata/](metadata/) (`de-DE.json`, `en-US.json`, `app.json`, `age-rating.json`, `review.json`) |
| Screenshots iPhone 6,9″ (1320 × 2868) | [screenshots/de/iphone/](screenshots/de/iphone/), [screenshots/en/iphone/](screenshots/en/iphone/) |
| Screenshots iPad 13″ (2064 × 2752) | [screenshots/de/ipad/](screenshots/de/ipad/), [screenshots/en/ipad/](screenshots/en/ipad/) |
| Bilder für die Android-Download-Seite (1080 × 2340) | [screenshots/android/](screenshots/android/) |
| Kopfzeile (Produktseite) 5244 × 2950 und 3840 × 1646, DE + EN | [header/](header/) – Quelle [header.html](header.html) (`?lang=en`), rendern: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=2622,1475 --screenshot=$PWD/docs/store/header/kopfzeile-de-5244x2950.png "file://$PWD/docs/store/header.html?lang=de"` (bzw. `--window-size=1920,823` für 3840 × 1646), danach als JPEG speichern; Upload per Hand |
| Screenshots neu erzeugen | `npm run build && node docs/store/storeshots.mjs` (Wegwerf-Instanz mit Demo-Bibliothek aus [demo-books.json](demo-books.json), braucht Internet; `ONLY=iphone,ipad,android`) |
| Hochladen (Texte, Kategorie, Altersfreigabe, Review, Screenshots) | `python3 native/ios/Scripts/asc_metadata.py [--no-screenshots]` (pyjwt, cryptography, requests; Schlüssel in `~/.appstoreconnect/`, Review-Kontakt in `~/.appstoreconnect/review-contact.json`) |
| Datenschutzerklärung | https://bookshelv.aize-it.de/privacy |
| Support | https://github.com/sgitaize/bookshelv/issues |

Die Demo-Daten (Mara, Jonas, Aylin, Ben) sind erfunden; Buchdaten und Cover kommen echt von DNB/Open Library.

## 1. App in App Store Connect anlegen (per Hand – die API darf keine Apps anlegen)

Meine Apps → **+** → Neue App:

| Feld | Wert |
|---|---|
| Plattform | iOS |
| Name | `bookshelv` (falls vergeben: `bookshelv – Bücherregal`, dann in `metadata/*.json` „name“ anpassen) |
| Primäre Sprache | Deutsch |
| Bundle-ID | `de.sgitaize.bookshelv` (existiert schon, von Xcode angelegt: „XC de sgitaize bookshelv“, mit iCloud, In-App-Kauf, Associated Domains) |
| SKU | `bookshelv` |
| Benutzerzugriff | Uneingeschränkt |

Danach läuft alles Weitere per Skript: `python3 native/ios/Scripts/asc_metadata.py`.

## 2. Per Hand (API-Schlüssel darf das nicht)

**Preis und Verfügbarkeit:** Kostenlos, alle Länder.

**In-App-Käufe (Trinkgeld)** – drei *Verbrauchsartikel*, die IDs stehen fest in `native/ios/Bookshelv/Store/TipJar.swift`:

| Produkt-ID | Referenzname | Preis (Vorschlag) | Anzeigename DE / EN | Beschreibung DE / EN |
|---|---|---|---|---|
| `de.sgitaize.bookshelv.tip.small` | Trinkgeld klein | 0,99 € | Ein Kaffee / A coffee | Danke! Schaltet nichts frei, hilft einfach. / Thank you! Unlocks nothing, it just helps. |
| `de.sgitaize.bookshelv.tip.medium` | Trinkgeld mittel | 2,99 € | Ein Taschenbuch / A paperback | Danke! Schaltet nichts frei, hilft einfach. / Thank you! Unlocks nothing, it just helps. |
| `de.sgitaize.bookshelv.tip.large` | Trinkgeld groß | 4,99 € | Ein Hardcover / A hardcover | Danke! Schaltet nichts frei, hilft einfach. / Thank you! Unlocks nothing, it just helps. |

Je Produkt verlangt Apple einen Review-Screenshot (Einstellungen → App → bookshelv unterstützen) und den Hinweis „Freiwilliges Trinkgeld, schaltet nichts frei“. Beim **ersten** Einreichen die Käufe auf der Versionsseite unter „In-App-Käufe“ mit auswählen, sonst prüft Apple sie nicht mit. Ohne angelegte Produkte zeigt die App „Trinkgeld ist gerade nicht verfügbar“.

**App-Datenschutz** („Datenerfassung: Ja“, kein Tracking) – erfasst wird nur mit Konto auf einer Instanz; ohne Konto verlässt nichts das Gerät:

| Datentyp | Zweck | Mit Identität verknüpft | Tracking |
|---|---|---|---|
| Kennungen → Benutzer-ID (Anmeldename) | App-Funktionalität | Ja | Nein |
| Kontaktinfos → Name (Anzeigename, freiwillig) | App-Funktionalität | Ja | Nein |
| Nutzerinhalte → Fotos oder Videos (Profilbild, eigene Cover, freiwillig) | App-Funktionalität | Ja | Nein |
| Nutzerinhalte → Andere Nutzerinhalte (Bibliothek, Bewertungen, Kommentare, Leselisten, Verleih) | App-Funktionalität | Ja | Nein |

Nicht erfasst: E-Mail, Telefon, Standort, Kontakte, Diagnose, Nutzungsdaten, Werbe-Kennungen, Kaufdaten (Trinkgeld läuft komplett über Apple).
Buchsuche/ISBN gehen ohne Konto direkt an DNB/Open Library (Drittanbieter, kein Partner, nichts wird dort gespeichert, was dir zuordenbar wäre) – siehe `/privacy`.

**Altersfreigabe:** wird per Skript gesetzt (`metadata/age-rating.json`: überall „Keine“, nutzergenerierte Inhalte + Nachrichten = Ja). Falls Apple Fragen hinzugefügt hat, meldet das Skript es – dann in ASC beantworten.

**Kopfzeile** (falls angeboten): `header/kopfzeile-*.jpg` per Drag & Drop.

## 3. Build hochladen

```bash
npm ci && npm run build:app
cd native/ios && xcodegen
xcodebuild -project Bookshelv.xcodeproj -scheme Bookshelv -configuration Release -destination 'generic/platform=iOS' \
  -archivePath /tmp/Bookshelv.xcarchive -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath /tmp/Bookshelv.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath /tmp/bookshelv-export -allowProvisioningUpdates
```

`ExportOptions.plist`: `method app-store-connect`, `destination upload`, Team `V7GQKCH73F`, automatische Signierung. Die
Distribution-Signatur kommt aus der Cloud über die Apple-ID in Xcode (nicht mit dem API-Schlüssel). Vor jedem weiteren
Upload `CURRENT_PROJECT_VERSION` in `project.yml` erhöhen.

## Bekannte Review-Fragen

- **4.2 Mindestfunktion / Web-Wrapper:** Der ganze Server läuft im Gerät (eingebettetes Node.js + SQLite), voll offline ohne Konto, VisionKit-Scanner mit Massen-Scan, iCloud-Sicherung, „Öffnen in“ für CSV, Teilen-Dialog, StoreKit. Steht in den Review-Notizen.
- **1.2 Nutzerinhalte:** Mit Konto gibt es Bewertungen, Kommentare und Profile anderer Personen. Vorhanden: Freundschaften (Feed standardmäßig nur Freund*innen), Sichtbarkeit je Bewertung, Spoilerschutz, Admin kann Konten sperren und Inhalte löschen. **Es fehlt ein „Melden“ und „Blockieren“ für Nutzer*innen** – das prüft Apple bei offener Registrierung gern. Wenn Apple danach fragt: Melden-Knopf an Bewertungen/Kommentaren/Profilen (→ Admin-Liste) und Blockieren (blendet Inhalte der Person aus) nachrüsten, Zusage „Meldungen innerhalb von 24 Stunden“.
- **5.1.1(v) Konto löschen:** Einstellungen → Konto → Konto löschen (nur mit Konto sichtbar).
- **3.1.1 Trinkgeld:** Verbrauchsartikel, schaltet nichts frei – erlaubt.

## Android

Kein Play Store: Die signierte APK kommt als GitHub-Release `bookshelv.apk` (Dauerlink
`https://github.com/sgitaize/bookshelv/releases/latest/download/bookshelv.apk`), verlinkt von simongutjahr.de. Bauen:
siehe [native/README.md](../../native/README.md#android). Bilder für die Download-Seite: `screenshots/android/`.
