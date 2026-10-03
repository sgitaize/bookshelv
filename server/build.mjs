// Baut das deploybare Paket nach ../dist:
//   dist/server.js   – Backend als eine CommonJS-Datei, ohne node_modules lauffähig (Plesk/Passenger, Docker)
//   dist/public/     – gebautes Frontend (vorher `npm run build -w web`)
//   dist/package.json
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('dist/', root);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

rmSync(new URL('server.js', out), { force: true });
rmSync(new URL('public', out), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: new URL('server.js', out).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  legalComments: 'none',
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info'
});

const web = new URL('web/dist/', root);
if (existsSync(web)) cpSync(web, new URL('public/', out), { recursive: true });
else console.warn('⚠ web/dist fehlt – Frontend zuerst bauen (npm run build)');

writeFileSync(new URL('package.json', out), JSON.stringify({
  name: 'bookshelv', version: pkg.version, private: true, main: 'server.js',
  scripts: { start: 'node server.js' }, engines: { node: '>=22.13' }
}, null, 2) + '\n');
