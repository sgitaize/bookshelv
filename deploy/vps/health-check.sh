#!/bin/bash
# Erreichbarkeit bookshelv über die öffentliche Adresse (nginx + TLS + Dienst) → healthchecks.io.
# Ping-URL als systemd-Credential "hc" (aus /var/lib/backup/hc-urls, Zeile bookshelvup=…).
set -uo pipefail
PING=$(sed -n 's/^bookshelvup=//p' "$CREDENTIALS_DIRECTORY/hc"); [ -n "$PING" ] || { echo "Ping-URL fehlt"; exit 1; }
H=bookshelv.aize-it.de; err=""
s=$(curl -fsS -m 15 "https://$H/api/status" 2>&1) || err+="status: ${s:0:80}; "
grep -q '"needsSetup":false' <<<"$s" || err+="status unerwartet; "
curl -fsS -m 15 -o /dev/null "https://$H/api/fed/info" || err+="fed/info nicht erreichbar; "
end=$(echo | timeout 10 openssl s_client -connect $H:443 -servername $H 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -z "$end" ]; then err+="Zertifikat nicht lesbar; "
else d=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 )); [ "$d" -lt 10 ] && err+="Zertifikat läuft in $d Tagen ab; "; fi
if [ -z "$err" ]; then curl -fsS -m 10 -o /dev/null "$PING"; echo ok
else curl -fsS -m 10 -o /dev/null --data-raw "$err" "$PING/fail"; echo "FEHLER: $err"; exit 1; fi
