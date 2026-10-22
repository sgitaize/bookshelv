#!/bin/bash
# Notfall-Rückweg VPS → netcup (Plesk). Seit 2026-10-22 läuft bookshelv auf dem VPS (bookshelv@prod); auf netcup ist
# die App deaktiviert (app/server.js → server.js.vps-umzug), Code und alter Datenstand liegen dort noch.
# Ablauf (als root): rollback-netcup.sh → VPS-Dienst stoppen, Daten nach netcup, netcup-App an;
#   danach DNS bookshelv.aize-it.de (A/AAAA) zurück auf 91.204.46.91 / 2a03:4000:30:96a7::13:9074
#   und in .env.deploy DEPLOY_FROM_HOST wieder auf den Hostnamen des VPS setzen.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Bitte als root (sudo)"; exit 1; }
REPO=$(cd "$(dirname "$0")/../.." && pwd); eval "$(grep -E '^DEPLOY_(HOST|USER|SSH_KEY|APP_DIR)=' "$REPO/.env.deploy")"
V=/srv/bookshelv-prod/var
read -r -p "bookshelv wirklich auf netcup zurückschalten? (ja) " a; [ "$a" = ja ] || exit 1
systemctl stop bookshelv@prod
S="ssh -i $DEPLOY_SSH_KEY -o BatchMode=yes $DEPLOY_USER@$DEPLOY_HOST"
$S "cd $DEPLOY_APP_DIR && rm -rf data.vor-rueckweg && mv data data.vor-rueckweg && mkdir data"
tar czf - --exclude=covers/preview -C "$V" . | $S "tar xzf - -C $DEPLOY_APP_DIR/data"
$S "cd $DEPLOY_APP_DIR && mv server.js.vps-umzug server.js && touch tmp/restart.txt"
sleep 5
curl -fsS -m 30 --resolve bookshelv.aize-it.de:443:91.204.46.91 https://bookshelv.aize-it.de/api/status >/dev/null && echo "netcup läuft wieder – jetzt DNS zurückstellen" || echo "netcup antwortet nicht – Plesk prüfen"
