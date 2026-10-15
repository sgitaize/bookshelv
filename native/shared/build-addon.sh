#!/usr/bin/env bash
# Baut sqlite_napi.c als normales Node-Addon für den Mac – nur zum Testen des Mobil-Bundles
# mit Node 18 im JIT-losen Modus (wie auf iOS). Aufruf: native/shared/build-addon.sh <node-include-dir> <out.node>
set -euo pipefail
INC=${1:?Node-Header-Ordner, z. B. …/node-v18/include/node}
OUT=${2:?Ziel, z. B. /tmp/bookshelv_sqlite.node}
cc -O2 -Wall -DBOOKSHELV_ADDON -DNODE_GYP_MODULE_NAME=bookshelv_sqlite -DNAPI_VERSION=8 -I"$INC" \
  -bundle -undefined dynamic_lookup -o "$OUT" "$(dirname "$0")/sqlite_napi.c" -lsqlite3
echo "gebaut: $OUT"
