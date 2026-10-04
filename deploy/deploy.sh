#!/usr/bin/env bash
# Lädt dist/ per SSH auf ein Plesk/Passenger-Hosting und startet die App neu.
# Konfiguration in .env.deploy (siehe .env.deploy.example). data/ auf dem Server bleibt unangetastet.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.deploy ] || { echo "Fehlt: .env.deploy (Vorlage: .env.deploy.example)"; exit 1; }
set -a; source .env.deploy; set +a
[ -f dist/server.js ] || { echo "Fehlt: dist/ – erst 'npm run build'"; exit 1; }

# Regel: Deploy nur von der festgelegten Maschine und nur, was auf GitHub (origin/main) liegt.
# So landet nie Code auf Prod, der nicht im Repo gepflegt ist.
fail() { echo "✗ Deploy abgebrochen: $1"; exit 1; }
[ -n "${DEPLOY_FROM_HOST:-}" ] || fail "DEPLOY_FROM_HOST fehlt in .env.deploy"
[ "$(hostname)" = "$DEPLOY_FROM_HOST" ] || fail "nur von '$DEPLOY_FROM_HOST' erlaubt, hier ist '$(hostname)'"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || fail "nicht auf Branch main"
[ -z "$(git status --porcelain)" ] || fail "uncommittete Änderungen – erst committen und pushen"
git fetch -q origin main || fail "GitHub nicht erreichbar"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "lokales main ≠ origin/main – erst pushen bzw. pullen"
COMMIT=$(git rev-parse --short HEAD)

SSH=(ssh -o StrictHostKeyChecking=accept-new "$DEPLOY_USER@$DEPLOY_HOST")
if [ -n "${DEPLOY_SSH_KEY:-}" ]; then
  # Key hat Vorrang vor dem Passwort
  SSH=(ssh -i "${DEPLOY_SSH_KEY/#\~/$HOME}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "$DEPLOY_USER@$DEPLOY_HOST")
elif [ -n "${DEPLOY_PASSWORD:-}" ]; then
  export SSHPASS="$DEPLOY_PASSWORD"
  SSH=(sshpass -e "${SSH[@]}")
fi

echo "→ Hochladen nach ~/$DEPLOY_APP_DIR"
# public/ komplett ersetzen (alte Asset-Hashes weg), server.js + package.json überschreiben, data/ behalten
COPYFILE_DISABLE=1 tar --no-xattrs -C dist -czf - server.js package.json public | "${SSH[@]}" "
  set -e
  mkdir -p ~/$DEPLOY_APP_DIR/data ~/$DEPLOY_APP_DIR/tmp
  cd ~/$DEPLOY_APP_DIR
  # Sicherung der Datenbank vor jedem Update (Migrationen!), die letzten 10 bleiben
  if [ -f data/bookshelv.db ]; then
    B=data/backups/\$(date +%Y%m%d-%H%M%S); mkdir -p \$B
    cp data/bookshelv.db* \$B/
    ls -1d data/backups/*/ | head -n -10 | xargs -r rm -rf
    echo \"  DB-Sicherung: \$B\"
  fi
  rm -rf public.new && mkdir public.new
  tar -xzf - -C public.new
  mv public.new/server.js public.new/package.json .
  rm -rf public && mv public.new/public public && rm -rf public.new
  echo $COMMIT > deployed-commit.txt
  touch tmp/restart.txt
  if [ -f data/setup-token.txt ]; then echo \"  Setup-Token: \$(cat data/setup-token.txt)\"; fi
"
# Gesundheitscheck: Passenger startet beim ersten Aufruf neu – bis zu 60 s auf /api/status warten.
# Startfehler zeigt Passenger nur als 500-Seite; die App schreibt sie nach data/crash.log.
URL="${DEPLOY_URL:-https://${DEPLOY_APP_DIR%%/*}}"
for i in $(seq 1 20); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL/api/status" || true)
  [ "$CODE" = 200 ] && break
  sleep 3
done
if [ "$CODE" != 200 ]; then
  echo "✗ $URL/api/status antwortet mit $CODE (Commit $COMMIT ist hochgeladen). Absturzprotokoll:"
  "${SSH[@]}" "tail -n 40 ~/$DEPLOY_APP_DIR/data/crash.log 2>/dev/null || echo '  (kein data/crash.log – App startet gar nicht? Plesk → Node.js prüfen)'"
  exit 1
fi
echo "✓ Deployt ($COMMIT), $URL antwortet."
