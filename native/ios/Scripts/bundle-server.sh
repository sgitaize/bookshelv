#!/usr/bin/env bash
# Kopiert App-Host (host.js) und Oberfläche (public/) ins App-Bundle nach server/.
# Gebaut wird beides vorher im Repo mit `npm run build:app` (Xcode hat kein Node im PATH).
set -euo pipefail
SRC="${SRCROOT}/../build/server"
DST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/server"
# Ist Node da (Homebrew), wird frisch gebaut – dann enthält jeder Build den aktuellen Stand
for n in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -x "$n" ]; then
    export PATH="$(dirname "$n"):$PATH"
    (cd "${SRCROOT}/../.." && npm run build:app >/dev/null) || { echo "error: npm run build:app fehlgeschlagen"; exit 1; }
    break
  fi
done
[ -f "$SRC/host.js" ] || { echo "error: $SRC/host.js fehlt – im Repo zuerst: npm run build:app"; exit 1; }
rm -rf "$DST"; mkdir -p "$DST"
cp "$SRC/host.js" "$DST/"
rsync -a "$SRC/public/" "$DST/public/"
echo "server/ gebündelt: $(du -sh "$DST" | cut -f1)"
