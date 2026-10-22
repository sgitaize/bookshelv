#!/bin/bash
# bookshelv auf dem VPS ausrollen – nur gepushte Commits (Commit → Push → Deploy). Baut als normaler Nutzer
# in einem frischen Ordner, installiert per sudo. Nutzung: deploy/vps/deploy.sh <instanz> [commit]
set -euo pipefail
INST=${1:?Instanz fehlt (z. B. test)}; REPO=$(cd "$(dirname "$0")/../.." && pwd)
BASE=/srv/bookshelv-$INST; ENVF=/etc/bookshelv-$INST/env
[ "$(id -u)" != 0 ] || { echo "Nicht als root bauen – als normaler Nutzer starten (sudo wird intern benutzt)"; exit 1; }
sudo -n test -f "$ENVF" || { echo "$ENVF fehlt – erst setup.sh"; exit 1; }
export PATH=/usr/local/lib/node-srv/bin:$PATH
cd "$REPO"; git fetch -q origin main
REV=$(git rev-parse "${2:-origin/main}")
git merge-base --is-ancestor "$REV" origin/main || { echo "Commit $REV ist nicht auf origin/main gepusht"; exit 1; }
B=$(mktemp -d); trap 'rm -rf "$B"' EXIT
git archive "$REV" | tar -x -C "$B"
(cd "$B" && npm ci --no-audit --no-fund --loglevel=error && npm run build >/dev/null)
[ -f "$B/dist/server.js" ] || { echo "Build ohne dist/server.js"; exit 1; }
echo "$REV" > "$B/dist/REVISION"; rm -rf "$B/dist/data"
PORT=$(sudo -n sed -n 's/^PORT=//p' "$ENVF")
# Datenbank vorher sichern (WAL-sicher über die sqlite-API, als Dienstnutzer)
if sudo -n test -f "$BASE/var/bookshelv.db"; then
  sudo -n -u bookshelv /usr/local/lib/node-srv/bin/node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec("VACUUM INTO \x27"+process.argv[2]+"\x27")' "$BASE/var/bookshelv.db" "$BASE/var/pre-deploy.db.tmp" && sudo -n mv -f "$BASE/var/pre-deploy.db.tmp" "$BASE/var/pre-deploy.db"
fi
sudo -n rm -rf "$BASE/app.new"; sudo -n cp -r "$B/dist" "$BASE/app.new"
sudo -n chown -R root:root "$BASE/app.new"; sudo -n chmod -R u=rwX,go=rX "$BASE/app.new"
sudo -n sh -c "[ -d '$BASE/app' ] && rm -rf '$BASE/app.old' && mv '$BASE/app' '$BASE/app.old'; mv '$BASE/app.new' '$BASE/app'"
sudo -n systemctl restart "bookshelv@$INST"
for i in $(seq 1 40); do sleep 0.5; curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" && { echo "OK: bookshelv $INST läuft mit $(git rev-parse --short "$REV")"; exit 0; }; done
echo "Start fehlgeschlagen – zurück auf den alten Stand"; sudo -n journalctl -u "bookshelv@$INST" -n 20 --no-pager
sudo -n sh -c "[ -d '$BASE/app.old' ] && rm -rf '$BASE/app' && mv '$BASE/app.old' '$BASE/app' && systemctl restart 'bookshelv@$INST'" || true
exit 1
