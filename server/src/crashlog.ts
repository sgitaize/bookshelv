/**
 * Absturzprotokoll: Unter Plesk/Passenger landet stderr nirgends, wo man es lesen kann – ein Startfehler
 * zeigt nur eine 500-Seite. Deshalb schreiben unbehandelte Fehler zusätzlich nach data/crash.log (max. ~200 KB).
 * index.ts lädt den eigentlichen Server (main.ts) per require in try/catch: Passenger fängt Ladefehler selbst ab,
 * ein globaler Handler sähe Fehler beim Öffnen/Migrieren der DB sonst nie.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export function logCrash(kind: string, e: unknown) {
  try {
    const file = path.join(config.dataDir, 'crash.log');
    fs.mkdirSync(config.dataDir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 200_000) fs.renameSync(file, file + '.1');
    const msg = e instanceof Error ? e.stack ?? e.message : String(e);
    fs.appendFileSync(file, `${new Date().toISOString()} ${kind} (Node ${process.version}, ${config.version})\n${msg}\n\n`);
  } catch { /* Protokoll darf selbst nie abstürzen */ }
}

process.on('uncaughtException', e => { logCrash('uncaughtException', e); console.error(e); process.exit(1); });
process.on('unhandledRejection', e => { logCrash('unhandledRejection', e); console.error(e); });
