/**
 * Nur für Tests: der normale Server, aber gebaut wie in der App (Node 18, node:sqlite → natives Modul, eigenes fetch).
 * So läuft die komplette API-Testsuite gegen den SQLite-Shim: SERVER_JS=… SERVER_NODE="node18 --jitless" tests/run.sh
 */
import './shims.ts';
require('../index.ts');
