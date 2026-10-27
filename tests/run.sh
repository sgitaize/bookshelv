#!/usr/bin/env bash
# Startet dist/server.js mit frischen Daten auf Port 3999 und führt die Tests aus.
#   tests/run.sh            API-Tests (Setup, Reviews, Verleih)
#   tests/run.sh --offline  zusätzlich Offline-Test im Browser
#   tests/run.sh --ui       zusätzlich Offline-Test und Überlauf-Audit in Chrome/Chromium (DE + EN parallel, 320–1920 px)
#   ONLY=/settings,/stats tests/run.sh --ui   Überlauf-Audit nur für diese Seiten (schnell)
# Voraussetzung: npm run build; für --ui einmalig (cd tests && npm install)
# Wie in der App (Node 18 ohne JIT, natives SQLite): SERVER_JS=../native/build/test/server.js SERVER_NODE="…/node --jitless" \
#   BOOKSHELV_SQLITE_ADDON=…/bookshelv_sqlite.node tests/run.sh   (siehe native/README.md)
set -euo pipefail
cd "$(dirname "$0")"
[ -f ../dist/server.js ] || { echo "Erst bauen: npm run build"; exit 1; }
if curl -sf localhost:3999/api/status >/dev/null; then echo "Port 3999 ist belegt – läuft noch ein Testserver?"; exit 1; fi
# Katalogabrufe über den Fixture-Proxy (aufgezeichnete DNB-/Open-Library-Antworten, siehe catalog-fixtures.mjs)
node catalog-fixtures.mjs 3988 & CP=$!
export BOOKSHELV_CATALOG_PROXY=http://localhost:3988
T=$(mktemp -d)
cp -r ../dist/package.json ../dist/public "$T/"; cp "${SERVER_JS:-../dist/server.js}" "$T/server.js"
(cd "$T" && PORT=3999 BOOKSHELV_INSECURE_COOKIES=1 BOOKSHELV_PUSH_ALLOW_HTTP=1 BOOKSHELV_PUSHOVER_API=http://localhost:3989/pushover BOOKSHELV_TELEGRAM_API=http://localhost:3989/tg NODE_NO_WARNINGS=1 exec ${SERVER_NODE:-node} server.js > server.log 2>&1) &
PID=$!
trap 'kill $PID $CP 2>/dev/null; rm -rf "$T"' EXIT
for i in $(seq 1 50); do curl -sf localhost:3999/api/status >/dev/null && break; sleep 0.2; done
node api.mjs "$T"
node loans.mjs
node requests.mjs
node reads.mjs
node series.mjs
node authors.mjs
node audio.mjs
node social.mjs
node extras.mjs
node stats.mjs
node features.mjs
node share.mjs
node lists.mjs
node booky.mjs
node jobs.mjs
node friends.mjs
node picks.mjs
# Föderation: zwei weitere frische Instanzen
FA=$(mktemp -d); FB=$(mktemp -d)
for d in "$FA" "$FB"; do cp -r ../dist/package.json ../dist/public "$d/"; cp "${SERVER_JS:-../dist/server.js}" "$d/server.js"; done
(cd "$FA" && PORT=3997 BOOKSHELV_PUBLIC_URL=http://localhost:3997 BOOKSHELV_FED_ALLOW_HTTP=1 BOOKSHELV_INSECURE_COOKIES=1 NODE_NO_WARNINGS=1 exec ${SERVER_NODE:-node} server.js > server.log 2>&1) &
PA=$!
(cd "$FB" && PORT=3996 BOOKSHELV_PUBLIC_URL=http://localhost:3996 BOOKSHELV_FED_ALLOW_HTTP=1 BOOKSHELV_INSECURE_COOKIES=1 NODE_NO_WARNINGS=1 exec ${SERVER_NODE:-node} server.js > server.log 2>&1) &
PB=$!
trap 'kill $PID $CP $PA $PB 2>/dev/null; rm -rf "$T" "$FA" "$FB"' EXIT
for i in $(seq 1 50); do curl -sf localhost:3997/api/status >/dev/null && curl -sf localhost:3996/api/status >/dev/null && break; sleep 0.2; done
node federation.mjs "$FA" "$FB"
# App-Host (Lokal-Modus, Proxy, Zusammenführen) – nur mit BOOKSHELV_SQLITE_ADDON, sonst übersprungen
node app.mjs

# Offline-Modus im Browser (auch einzeln: tests/run.sh --offline)
if [ "${1:-}" = "--ui" ] || [ "${1:-}" = "--offline" ]; then node offline.mjs; node ui.mjs; fi
if [ "${1:-}" = "--ui" ]; then
  # DE und EN parallel (eigene Browser); ONLY=/settings,/stats prüft nur diese Seiten
  node overflow.mjs "$T" "${SHOTS:-}" & OD=$!
  LANG_EN=1 node overflow.mjs "$T" "" & OE=$!
  wait $OD; wait $OE
  [ -n "${SHOTS:-}" ] && cp "$T"/shot-*.png "${SHOTDIR:-/tmp}/" 2>/dev/null || true
fi
