#!/bin/bash
# Einmalig je Instanz (als root): Nutzer, Ordner, Umgebung, systemd, nginx (erst HTTP; TLS nach DNS mit --tls).
# Nutzung: deploy/vps/setup.sh <instanz> <host> <port> [--tls]
set -euo pipefail
INST=${1:?Instanz}; HOST=${2:?Host}; PORT=${3:?Port}; TLS=${4:-}; DIR=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo "Bitte als root (sudo)"; exit 1; }
id bookshelv >/dev/null 2>&1 || { useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --user-group bookshelv; passwd -l bookshelv >/dev/null; }
install -d -o root -g root -m 755 /srv/bookshelv-$INST
install -d -o bookshelv -g bookshelv -m 700 /srv/bookshelv-$INST/var
install -d -o root -g root -m 700 /etc/bookshelv-$INST
ENVF=/etc/bookshelv-$INST/env
[ -f "$ENVF" ] || { umask 077; printf 'PORT=%s\nBOOKSHELV_PUBLIC_URL=https://%s\n' "$PORT" "$HOST" > "$ENVF"; }
install -m 644 "$DIR/bookshelv@.service" /etc/systemd/system/bookshelv@.service
systemctl daemon-reload; systemctl enable -q "bookshelv@$INST"
install -d -m 755 /var/www/letsencrypt
CONF=/etc/nginx/sites-available/bookshelv-$INST.conf
sed "s/__HOST__/$HOST/g; s/__PORT__/$PORT/g" "$DIR/nginx.conf" > "$CONF"
if [ "$TLS" = --tls ]; then
  [ -f /etc/letsencrypt/live/$HOST/fullchain.pem ] || certbot certonly --webroot -w /var/www/letsencrypt -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --deploy-hook "systemctl reload nginx"
  sed "s/__HOST__/$HOST/g; s/__PORT__/$PORT/g" "$DIR/nginx-tls.conf" >> "$CONF"
fi
rm -f /etc/nginx/sites-enabled/default
[ -f /etc/nginx/sites-enabled/00-catchall.conf ] || printf 'server {\n  listen 80 default_server;\n  listen [::]:80 default_server;\n  listen 443 ssl default_server;\n  listen [::]:443 ssl default_server;\n  ssl_reject_handshake on;\n  server_name _;\n  server_tokens off;\n  return 444;\n}\n' > /etc/nginx/sites-enabled/00-catchall.conf
ln -sf "$CONF" /etc/nginx/sites-enabled/
nginx -t -q && systemctl reload nginx
echo "Setup $INST ($HOST → 127.0.0.1:$PORT) fertig${TLS:+ mit TLS}"
