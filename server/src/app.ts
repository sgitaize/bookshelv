import fs from 'node:fs';
import path from 'node:path';
import { HTTPException } from 'hono/http-exception';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { config } from './config.ts';
import { loadUser } from './auth.ts';
import { coverPath } from './catalog.ts';
import { authRoutes } from './routes/auth.ts';
import { bookRoutes } from './routes/books.ts';
import { readingRoutes } from './routes/reading.ts';
import { reviewRoutes } from './routes/reviews.ts';
import { loanRoutes } from './routes/loans.ts';
import { historyRoutes } from './routes/history.ts';
import { socialRoutes } from './routes/social.ts';
import { federationRoutes } from './routes/federation.ts';
import { extraRoutes } from './routes/extras.ts';
import { statsRoutes } from './routes/stats.ts';
import { listRoutes } from './routes/lists.ts';
import { readRoutes } from './routes/reads.ts';
import { authorRoutes } from './routes/authors.ts';
import { exportRoutes } from './routes/export.ts';
import { adminRoutes } from './routes/admin.ts';
import { router } from './util.ts';
import { translate } from './i18n.ts';

export const app = router();

app.use(secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'"],
    workerSrc: ["'self'", 'blob:'],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"]
  },
  permissionsPolicy: { camera: ['self'], microphone: [], geolocation: [] },
  crossOriginEmbedderPolicy: false
}));
app.use('/api/*', csrf());
app.use('/api/*', loadUser);

app.route('/api', authRoutes);
app.route('/api', bookRoutes);
app.route('/api', readingRoutes);
app.route('/api', reviewRoutes);
app.route('/api', loanRoutes);
app.route('/api', historyRoutes);
app.route('/api', socialRoutes);
app.route('/api', federationRoutes);
app.route('/api', extraRoutes);
app.route('/api', statsRoutes);
app.route('/api', listRoutes);
app.route('/api', readRoutes);
app.route('/api', authorRoutes);
app.route('/api', exportRoutes);
app.route('/api/admin', adminRoutes);
app.all('/api/*', c => c.json({ error: translate('Unbekannter Endpunkt', c.req.header('x-lang')) }, 404));

app.onError((err, c) => {
  const lang = c.req.header('x-lang');
  if (err instanceof HTTPException) return c.json({ error: translate(err.message, lang) }, err.status);
  console.error(err);
  return c.json({ error: translate('Interner Fehler', lang) }, 500);
});

// ---------- Cover & Frontend ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain'
};

function sendFile(file: string, cache: string) {
  return new Response(fs.readFileSync(file), {
    headers: { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache }
  });
}

app.get('/covers/:name', c => {
  const file = coverPath(c.req.param('name'));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return c.body(null, 404);
  // Dateinamen enthalten einen Zufallsanteil → dürfen ewig gecacht werden
  return sendFile(file, 'public, max-age=31536000, immutable');
});

app.get('*', c => {
  const rel = path.normalize(decodeURIComponent(c.req.path)).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(config.publicDir, rel);
  if (file.startsWith(config.publicDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const immutable = rel.startsWith('/assets/');
    return sendFile(file, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  }
  // SPA: alle anderen Pfade liefern die App, der Client-Router übernimmt
  const index = path.join(config.publicDir, 'index.html');
  if (fs.existsSync(index)) return sendFile(index, 'no-cache');
  return c.text('bookshelv: Frontend nicht gebaut (npm run build)', 503);
});
