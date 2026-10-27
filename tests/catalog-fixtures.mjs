// Katalog-Proxy für die Tests: spielt aufgezeichnete Antworten von DNB/Open Library ab (fixtures/catalog/),
// fehlende werden einmal live geholt und gespeichert (DNB, K10plus, Open Library). So hängt die Suite nicht davon ab, ob die DNB gerade drosselt (429).
// Bilder werden nur durchgereicht, nicht gespeichert. Start: node catalog-fixtures.mjs [port]; Server mit BOOKSHELV_CATALOG_PROXY=http://localhost:<port>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const port = Number(process.argv[2] ?? 3988);
const dir = path.join(import.meta.dirname, 'fixtures', 'catalog');
fs.mkdirSync(dir, { recursive: true });
const ALLOWED = /^https:\/\/(services\.dnb\.de|portal\.dnb\.de|sru\.k10plus\.de|openlibrary\.org|covers\.openlibrary\.org)\//;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x').searchParams.get('url') ?? '';
  if (!ALLOWED.test(url)) { res.writeHead(400).end(); return; }
  const file = path.join(dir, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json');
  if (fs.existsSync(file)) {
    const f = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.writeHead(f.status, { 'content-type': f.type }).end(f.body);
    return;
  }
  try {
    // Open Library setzt Verbindungen gelegentlich zurück → beim Aufnehmen bis zu dreimal versuchen
    let live;
    for (let i = 0; ; i++) {
      try { live = await fetch(url, { headers: { 'User-Agent': 'bookshelv-tests' }, signal: AbortSignal.timeout(20000), redirect: 'follow' }); break; }
      catch (e) { if (i === 2) throw e; }
    }
    const type = live.headers.get('content-type') ?? '';
    const buf = Buffer.from(await live.arrayBuffer());
    // alles aufzeichnen außer Bildern, auch 429 – dann prüfen die Tests mit gedrosselter DNB eben den Weg über K10plus,
    // aber bei jedem Lauf gleich. Neu aufnehmen: Datei in fixtures/catalog/ löschen
    if (!type.startsWith('image/')) fs.writeFileSync(file, JSON.stringify({ url, status: live.status, type, body: buf.toString('utf8') }, null, 1));
    res.writeHead(live.status, { 'content-type': type }).end(buf);
  } catch (e) {
    console.log(`catalog-fixtures: ${e.name} ${e.cause?.code ?? ""} ${url}`);
    res.writeHead(504).end();
  }
}).listen(port, '127.0.0.1');
