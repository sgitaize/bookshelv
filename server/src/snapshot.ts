/**
 * Sicherungskopie der Datenbank für das externe Backup (Projekt „backups“ auf dem VPS):
 * VACUUM INTO schreibt einen konsistenten Stand trotz WAL nach data/snapshot/bookshelv.db.
 * Stündlich und beim Start (wenn älter als 1 h); der VPS holt die Datei per SSH ab.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { db } from './db.ts';

const dir = path.join(config.dataDir, 'snapshot');
const file = path.join(dir, 'bookshelv.db');

export function snapshot(maxAgeMs = 0) {
  try {
    if (maxAgeMs && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < maxAgeMs) return;
    fs.mkdirSync(dir, { recursive: true });
    // eigener Temp-Name je Prozess (Passenger kann mehrere starten), danach atomar umbenennen
    const tmp = path.join(dir, `bookshelv.${process.pid}.tmp`);
    fs.rmSync(tmp, { force: true });
    db.prepare('VACUUM INTO ?').run(tmp);
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('Snapshot fehlgeschlagen', e);
  }
}
