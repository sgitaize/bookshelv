#!/usr/bin/env bash
# Lädt, was zu groß fürs Repo ist:
#  - nodejs-mobile (Node 18 für Android, MIT) nach app/libnode/
#  - SQLite-Amalgamation (Public Domain) nach app/sqlite/ – Android hat keine öffentliche SQLite-C-API im NDK
set -euo pipefail
NODE_VER=v18.20.4
SQLITE_YEAR=2025
SQLITE_VER=3500400
cd "$(dirname "$0")/../app"
if [ ! -f libnode/bin/arm64-v8a/libnode.so ]; then
  rm -rf libnode && mkdir -p libnode && cd libnode
  curl -fL -o nm.zip "https://github.com/nodejs-mobile/nodejs-mobile/releases/download/$NODE_VER/nodejs-mobile-$NODE_VER-android.zip"
  unzip -q nm.zip && rm nm.zip
  # Archiv enthält einen Ordner auf oberster Ebene → flach ziehen
  top=$(ls -d */ | head -1); if [ ! -d bin ] && [ -n "$top" ]; then mv "$top"* . && rmdir "$top"; fi
  cd ..
fi
if [ ! -f sqlite/sqlite3.c ]; then
  rm -rf sqlite && mkdir -p sqlite && cd sqlite
  curl -fL -o s.zip "https://www.sqlite.org/$SQLITE_YEAR/sqlite-amalgamation-$SQLITE_VER.zip"
  unzip -q -j s.zip '*/sqlite3.c' '*/sqlite3.h' && rm s.zip
  cd ..
fi
ls libnode/bin sqlite
