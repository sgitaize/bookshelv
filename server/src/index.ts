import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { app } from './app.ts';
import { config } from './config.ts';
import { ensureSetupToken } from './routes/auth.ts';
import { purgeExpiredSessions } from './auth.ts';
import { prunePreviews } from './catalog.ts';

ensureSetupToken();
purgeExpiredSessions();
prunePreviews();
setInterval(() => { purgeExpiredSessions(); prunePreviews(); }, 6 * 3600_000).unref();

const server = http.createServer(getRequestListener(app.fetch));

// Unter Plesk/Passenger wird nicht auf einen Port gehört, sondern auf den von Passenger vergebenen Socket
declare const PhusionPassenger: unknown;
const passenger = typeof PhusionPassenger !== 'undefined';
server.listen(passenger ? 'passenger' : config.port, () => {
  console.log(`bookshelv ${config.version} läuft ${passenger ? 'unter Passenger' : `auf http://localhost:${config.port}`} (Node ${process.version}, Daten: ${config.dataDir})`);
});
