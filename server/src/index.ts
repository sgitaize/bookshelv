import { logCrash } from './crashlog.ts';

// Startfehler (DB, Migration, Konfiguration) protokollieren – siehe crashlog.ts
try {
  require('./main.ts');
} catch (e) {
  logCrash('startup', e);
  throw e;
}
