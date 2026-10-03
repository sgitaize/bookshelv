import path from 'node:path';

declare const __VERSION__: string;

const built = typeof __VERSION__ !== 'undefined';
/** Gebaut liegt server.js direkt im App-Ordner (neben public/ und data/), im Dev-Modus ist es server/ */
const appDir = process.env.BOOKSHELV_APP_DIR ?? (built ? __dirname : process.cwd());

/** Alle Einstellungen kommen aus Umgebungsvariablen; die Standardwerte passen für Plesk und Docker. */
export const config = {
  version: built ? __VERSION__ : 'dev',
  port: Number(process.env.PORT) || 3000,
  /** Datenbank, Cover-Cache und Setup-Token – niemals im öffentlichen Webroot */
  dataDir: process.env.BOOKSHELV_DATA_DIR ?? path.join(appDir, 'data'),
  /** Gebautes Frontend */
  publicDir: process.env.BOOKSHELV_PUBLIC_DIR ?? path.join(appDir, 'public'),
  /** Cookies nur über HTTPS (lokal per BOOKSHELV_INSECURE_COOKIES=1 abschaltbar) */
  secureCookies: process.env.BOOKSHELV_INSECURE_COOKIES !== '1',
  sessionDays: 60,
  inviteDays: 14,
  /** Kontakt für den User-Agent bei Katalog-Anfragen (Open Library bittet darum) */
  userAgent: `bookshelv/${built ? __VERSION__ : 'dev'} (+https://github.com/sgitaize/bookshelv)`
};
