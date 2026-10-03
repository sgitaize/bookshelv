#!/usr/bin/env bash
# Startet dist/server.js mit frischen Daten auf Port 3999 und führt die Tests aus.
#   tests/run.sh            API-Tests (Setup, Reviews, Verleih)
#   tests/run.sh --offline  zusätzlich Offline-Test im Browser
#   tests/run.sh --ui       zusätzlich Offline-Test und Überlauf-Audit in Chrome/Chromium (DE + EN, 320–1920 px)
# Voraussetzung: npm run build; für --ui einmalig (cd tests && npm install)
set -euo pipefail
cd "$(dirname "$0")"
[ -f ../dist/server.js ] || { echo "Erst bauen: npm run build"; exit 1; }
if curl -sf localhost:3999/api/status >/dev/null; then echo "Port 3999 ist belegt – läuft noch ein Testserver?"; exit 1; fi
T=$(mktemp -d)
cp -r ../dist/server.js ../dist/package.json ../dist/public "$T/"
(cd "$T" && PORT=3999 BOOKSHELV_INSECURE_COOKIES=1 NODE_NO_WARNINGS=1 exec node server.js > server.log 2>&1) &
PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$T"' EXIT
for i in $(seq 1 50); do curl -sf localhost:3999/api/status >/dev/null && break; sleep 0.2; done
node api.mjs "$T"
node loans.mjs
node social.mjs
node extras.mjs
node stats.mjs
node lists.mjs
node booky.mjs
# Föderation: zwei weitere frische Instanzen
FA=$(mktemp -d); FB=$(mktemp -d)
for d in "$FA" "$FB"; do cp -r ../dist/server.js ../dist/package.json ../dist/public "$d/"; done
(cd "$FA" && PORT=3997 BOOKSHELV_PUBLIC_URL=http://localhost:3997 BOOKSHELV_FED_ALLOW_HTTP=1 BOOKSHELV_INSECURE_COOKIES=1 NODE_NO_WARNINGS=1 exec node server.js > server.log 2>&1) &
PA=$!
(cd "$FB" && PORT=3996 BOOKSHELV_PUBLIC_URL=http://localhost:3996 BOOKSHELV_FED_ALLOW_HTTP=1 BOOKSHELV_INSECURE_COOKIES=1 NODE_NO_WARNINGS=1 exec node server.js > server.log 2>&1) &
PB=$!
trap 'kill $PID $PA $PB 2>/dev/null; rm -rf "$T" "$FA" "$FB"' EXIT
for i in $(seq 1 50); do curl -sf localhost:3997/api/status >/dev/null && curl -sf localhost:3996/api/status >/dev/null && break; sleep 0.2; done
node federation.mjs "$FA" "$FB"

# Offline-Modus im Browser (auch einzeln: tests/run.sh --offline)
if [ "${1:-}" = "--ui" ] || [ "${1:-}" = "--offline" ]; then node offline.mjs; fi
if [ "${1:-}" = "--ui" ]; then
  node overflow.mjs "$T" "${SHOTS:-}"
  [ -n "${SHOTS:-}" ] && cp "$T"/shot-*.png "${SHOTDIR:-/tmp}/" 2>/dev/null || true
  LANG_EN=1 node overflow.mjs "$T" ""
fi
