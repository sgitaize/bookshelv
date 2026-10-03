#!/usr/bin/env bash
# Lädt dist/ per SSH auf ein Plesk/Passenger-Hosting und startet die App neu.
# Konfiguration in .env.deploy (siehe .env.deploy.example). data/ auf dem Server bleibt unangetastet.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.deploy ] || { echo "Fehlt: .env.deploy (Vorlage: .env.deploy.example)"; exit 1; }
set -a; source .env.deploy; set +a
[ -f dist/server.js ] || { echo "Fehlt: dist/ – erst 'npm run build'"; exit 1; }

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
  rm -rf public.new && mkdir public.new
  tar -xzf - -C public.new
  mv public.new/server.js public.new/package.json .
  rm -rf public && mv public.new/public public && rm -rf public.new
  touch tmp/restart.txt
  if [ -f data/setup-token.txt ]; then echo \"  Setup-Token: \$(cat data/setup-token.txt)\"; fi
"
echo "✓ Deployt. Passenger startet die App beim nächsten Aufruf neu."
