# bookshelv als App (iOS, später Android)

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
