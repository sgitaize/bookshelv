import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { app } from './app.ts';
import { config } from './config.ts';
import { ensureSetupToken } from './routes/auth.ts';
import { purgeExpiredSessions } from './auth.ts';
import { prunePreviews } from './catalog.ts';
import { deliver } from './federation.ts';
import { db } from './db.ts';
import { fetchCover, deleteCoverFile, dnbMarc, olSeries } from './catalog.ts';
import { kickImports } from './routes/extras.ts';
import { canonicalSeries } from './routes/books.ts';
import { checkAuthors } from './routes/authors.ts';

ensureSetupToken();
purgeExpiredSessions();
prunePreviews();
setInterval(() => { purgeExpiredSessions(); prunePreviews(); }, 6 * 3600_000).unref();
// Föderation: Warteschlange regelmäßig abarbeiten
setInterval(() => { deliver().catch(() => {}); }, 60_000).unref();
// Importe im Hintergrund: nach einem Neustart weitermachen, und zur Sicherheit jede Minute anstoßen
kickImports();
setInterval(kickImports, 60_000).unref();

/**
 * Einmalig (je Version des Flags): Bücher ohne Cover erneut versuchen – früher wurde nur unter der ISBN gesucht,
 * inzwischen auch am Open-Library-Werk. Läuft im Hintergrund, nacheinander, damit die Dienste nicht überlastet werden.
 */
async function repairMissingCovers() {
  const flag = 'covers_repaired_v1';
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(flag)) return;
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, datetime('now'))").run(flag);
  const books = db.prepare('SELECT id, isbn13 FROM books WHERE cover IS NULL AND isbn13 IS NOT NULL LIMIT 500').all() as { id: number; isbn13: string }[];
  for (const b of books) {
    const name = await fetchCover({ isbn: b.isbn13 }).catch(() => null);
    if (name && !db.prepare('UPDATE books SET cover = ? WHERE id = ? AND cover IS NULL').run(name, b.id).changes) deleteCoverFile(name);
  }
}
setTimeout(() => { repairMissingCovers().catch(e => console.error('Cover-Nachladen:', e)); }, 5000).unref();

/** Einmalig: Reihe/Band für Bestandsbücher aus der DNB nachladen (langsam, nacheinander; nur leere Felder) */
async function backfillSeries() {
  // Fortschritt = zuletzt geprüfte Buch-ID; schläft Passenger die App ein, geht es beim nächsten Start dort weiter
  const key = 'series_backfill_v1';
  const last = (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  if (last === 'done') return;
  const books = db.prepare('SELECT id, isbn13 FROM books WHERE series IS NULL AND isbn13 IS NOT NULL AND id > ? ORDER BY id').all(Number(last) || 0) as { id: number; isbn13: string }[];
  const mark = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const b of books) {
    const series = (await dnbMarc(b.isbn13).catch(() => null))?.series ?? await olSeries(b.isbn13).catch(() => null);
    if (series) db.prepare('UPDATE books SET series = ?, series_index = ? WHERE id = ? AND series IS NULL').run(canonicalSeries(series.name), series.index, b.id);
    mark.run(key, String(b.id));
    await new Promise(r => setTimeout(r, 400));
  }
  mark.run(key, 'done');
}
// Neuerscheinungen gefolgter Autor*innen: kurz nach dem Start und alle 6 Stunden (je Person höchstens täglich)
if (!process.env.BOOKSHELV_NO_BACKFILL) {
  setTimeout(() => { checkAuthors().catch(() => {}); }, 60_000).unref();
  setInterval(() => { checkAuthors().catch(() => {}); }, 6 * 3600_000).unref();
}
if (!process.env.BOOKSHELV_NO_BACKFILL) setTimeout(() => { backfillSeries().catch(e => console.error('Reihen-Nachladen:', e)); }, 15000).unref();

const server = http.createServer(getRequestListener(app.fetch));

// Unter Plesk/Passenger wird nicht auf einen Port gehört, sondern auf den von Passenger vergebenen Socket
declare const PhusionPassenger: unknown;
const passenger = typeof PhusionPassenger !== 'undefined';
server.listen(passenger ? 'passenger' : config.port, () => {
  console.log(`bookshelv ${config.version} läuft ${passenger ? 'unter Passenger' : `auf http://localhost:${config.port}`} (Node ${process.version}, Daten: ${config.dataDir})`);
});
