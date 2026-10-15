#!/usr/bin/env bash
# Meldet an healthchecks.io, ob die Instanz noch neue Konten annimmt (Admin → Höchstzahl Konten).
#   capacity-check.sh <instanz-url> <ping-url>
# ok → Ping „erfolgreich“; nearly (ab 90 %) oder full → Ping „fail“ mit Begründung (healthchecks benachrichtigt);
# Instanz nicht erreichbar → „fail“. Gedacht für einen stündlichen Timer/Cron auf einem anderen Rechner.
set -uo pipefail
URL=${1:?Instanz-URL, z. B. https://bookshelv.example}
PING=${2:?Ping-URL von healthchecks.io}
status=$(curl -fsS -m 20 "$URL/api/status") || { curl -fsS -m 10 --data-raw "Instanz $URL nicht erreichbar" "$PING/fail" >/dev/null; exit 1; }
cap=$(printf '%s' "$status" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("capacity","ok"))')
case "$cap" in
  ok) curl -fsS -m 10 --data-raw "capacity=ok" "$PING" >/dev/null ;;
  nearly) curl -fsS -m 10 --data-raw "Fast voll (ab 90 % der Höchstzahl Konten) – Admin → Höchstzahl Konten prüfen" "$PING/fail" >/dev/null ;;
  full) curl -fsS -m 10 --data-raw "Voll – keine neuen Konten mehr möglich (Admin → Höchstzahl Konten)" "$PING/fail" >/dev/null ;;
esac
echo "$cap"
