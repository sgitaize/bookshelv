# bookshelv als App (iOS und Android)

Die App bringt den bookshelv-Server selbst mit ([nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile), Node 18)
und zeigt die normale Oberfläche in einer WebView. Dadurch funktioniert alles, was die Website kann, auch **ohne Konto
und ohne Server**.

- **Ohne Konto (Standard):** Die Bibliothek liegt nur auf dem Gerät (SQLite). Buchdaten und Cover holt die App direkt
  bei DNB/Open Library. Die Sicherung landet in der eigenen iCloud (iCloud Drive → bookshelv) oder in einer Datei.
- **Mit Konto:** Die App spricht über einen eingebauten Proxy mit einer Instanz (die Sitzung bleibt im App-Host) und hält
  den ganzen eigenen Stand für unterwegs vor (Offline-Abgleich).
- **Mit Konto verbinden:** Die lokale Bibliothek wird als Import-Job ins Konto übernommen – mit Abgleich (keine Dubletten),
  Konfliktfragen und Rückgängig. Danach wird die lokale Datenbank archiviert.

## Aufbau

| Teil | Ort |
|---|---|
| App-Host (Steuerung, lokaler Server, Proxy zur Instanz) | `server/src/mobile/host.ts` |
| `node:sqlite`-Ersatz auf System-SQLite (N-API, statisch gelinkt) | `server/src/mobile/sqlite.ts`, `native/shared/sqlite_napi.c` |
| `fetch` ohne WebAssembly (V8 läuft auf iOS ohne JIT) | `server/src/mobile/shims.ts` |
| Brücke Weboberfläche ↔ App | `web/src/lib/app.svelte.ts` |
| iOS-App (SwiftUI, XcodeGen) | `native/ios/` |
| Android-App (Kotlin, Jetpack Compose, Gradle) | `native/android/` |

Besonderheiten von nodejs-mobile: kein JIT (also kein WebAssembly → kein undici-`fetch`), kein ICU (keine `\p{…}` in
Regexen – `build-mobile.mjs` bricht dann ab).

## Bauen

```bash
npm ci
npm run build:app                       # Oberfläche + App-Host → native/build/server/
cd native/ios
Scripts/fetch-nodejs-mobile.sh          # einmalig, 160 MB
echo "DEVELOPMENT_TEAM = XXXXXXXXXX" > Config/Local.xcconfig
xcodegen && open Bookshelv.xcodeproj
```

## Testen ohne Gerät

Node 18 im JIT-losen Modus verhält sich wie auf dem iPhone. Das SQLite-Modul lässt sich als normales Addon bauen:

```bash
curl -fsSL https://nodejs.org/dist/v18.20.4/node-v18.20.4-darwin-arm64.tar.gz | tar xz -C /tmp
native/shared/build-addon.sh /tmp/node-v18.20.4-darwin-arm64/include/node /tmp/bookshelv_sqlite.node
(cd server && node build-mobile.mjs --test-server)
# ganze Testsuite gegen den App-Build:
SERVER_JS=../native/build/test/server.js SERVER_NODE="/tmp/node-v18.20.4-darwin-arm64/bin/node --jitless" \
  BOOKSHELV_SQLITE_ADDON=/tmp/bookshelv_sqlite.node tests/run.sh
```

`tests/app.mjs` (läuft mit, sobald `BOOKSHELV_SQLITE_ADDON` gesetzt ist) prüft Lokal-Modus, Proxy, Zusammenführen und Sicherung.
Im Simulator lassen sich Seiten direkt öffnen: `xcrun simctl launch booted de.sgitaize.bookshelv -path /library` (nur Debug).

## Android

Gleicher Aufbau wie iOS: nodejs-mobile (Node 18) im APK, `server/host.js` mit denselben drei Ports, Oberfläche in einer
WebView. SQLite bringt die App selbst mit (Amalgamation, das NDK hat keine öffentliche SQLite-API) – zusammen mit
`native/shared/sqlite_napi.c` in `libbsnode.so`, das sich beim Laden als linked binding registriert.

| iOS | Android |
|---|---|
| VisionKit-Scanner | CameraX + ML Kit (Modell im APK, läuft ohne Google Play) – `Scanner.kt` |
| iCloud-Sicherung | Schnappschuss in `files/backup/` → Google-Sicherung des Geräts (`res/xml/data_extraction_rules.xml`), auf neuem Gerät automatisch übernommen – `Backup.kt` |
| Datei-Sicherung (Teilen) | Speichern/Öffnen über die Dateiauswahl (Drive, Downloads …) |
| StoreKit-Trinkgeld | Flavor `play`: Play Billing (gleiche Produkt-IDs, `src/play/…/Store.kt`); Flavor `github` (Download-APK): optionaler Spendenlink `DONATE_URL` in `src/github/…/Store.kt` |
| Updates über den App Store | Flavor `play`: Google Play; Flavor `github`: Hinweis beim Start, wenn auf GitHub ein neueres Release mit APK liegt (`Updates.kt`) |
| „Öffnen in“ für CSV | Intent-Filter VIEW/SEND (text/csv …) |
| Teilen-Dialog für Downloads | Blob-Downloads und `navigator.share` werden in der WebView abgefangen (`Web.kt`, SHIMS) und an den Android-Teilen-Dialog gegeben |

```bash
cd native/android
scripts/fetch-deps.sh                   # einmalig: nodejs-mobile (~130 MB) + SQLite-Amalgamation
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
./gradlew assembleGithubRelease         # baut vorher npm run build:app (mit -PskipWebBuild nur kopieren)
# → app/build/outputs/apk/github/release/app-github-release.apk (nur arm64-v8a, signiert über signing.properties)
./gradlew bundlePlayRelease             # App Bundle für Google Play (siehe docs/store/README.md)
```

SDK-Pakete: `platforms;android-35`, `build-tools;35.0.0`, `ndk;27.2.12479018`, `cmake;3.22.1`.
Signatur: `signing.properties` (nicht im Repo) zeigt auf den Keystore – Kopien in `~/.secrets/bookshelv-release.*` (Mac)
und `/root/.secrets/bookshelv-release.*` (VPS). **Keystore nie verlieren**, sonst lassen sich installierte APKs nicht mehr
aktualisieren. Zertifikat SHA-256: `62:9F:3E:BD:C6:4E:C0:02:85:F7:6A:22:A3:B7:C1:FA:3E:8A:50:35:3F:46:18:A8:98:56:90:96:77:EC:22:C9`.

Testen im Emulator: Debug-Build enthält zusätzlich x86_64; WebView-DevTools per
`adb forward tcp:9229 localabstract:webview_devtools_remote_$(adb shell pidof de.sgitaize.bookshelv)`.
Eine Test-Instanz auf dem Mac erreicht der Emulator unter `http://10.0.2.2:<port>` (der Host erlaubt http nur für IP-Adressen/localhost).
