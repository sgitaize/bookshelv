// Baut das Bundle für die Apps (nodejs-mobile = Node 18 ohne JIT) nach ../native/build/server/:
//   host.js   – App-Host (Steuerung, lokaler Server, Proxy zur Instanz), node:sqlite → natives Modul
//   public/   – gebautes Frontend (vorher `npm run build -w web`)
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('native/build/server/', root);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ['src/mobile/host.ts'],
  outfile: new URL('host.js', out).pathname,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  legalComments: 'none',
  alias: { 'node:sqlite': './src/mobile/sqlite.ts' },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info'
});

// Testserver: normaler Server mit denselben Ersatzteilen (für tests/run.sh mit Node 18 --jitless)
if (process.argv.includes('--test-server')) await build({
  entryPoints: ['src/mobile/server18.ts'],
  outfile: new URL('native/build/test/server.js', root).pathname,
  bundle: true, platform: 'node', target: 'node18', format: 'cjs', legalComments: 'none',
  alias: { 'node:sqlite': './src/mobile/sqlite.ts' },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info'
});

const web = new URL('web/dist/', root);
if (existsSync(web)) cpSync(web, new URL('public/', out), { recursive: true, filter: f => !f.endsWith('/sw.js') });
else console.warn('⚠ web/dist fehlt – Frontend zuerst bauen (npm run build -w web)');
