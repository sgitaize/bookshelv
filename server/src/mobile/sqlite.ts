/**
 * Ersatz für `node:sqlite` im Mobil-Bundle (nodejs-mobile = Node 18, dort gibt es node:sqlite nicht).
 * Bildet den Teil von DatabaseSync/StatementSync nach, den der Server nutzt, auf dem nativen Modul
 * `bookshelv_sqlite` (native/shared/sqlite_napi.c, System-SQLite). Das Bundle ersetzt `node:sqlite` per Alias hierdurch.
 */
type Native = {
  open(path: string): unknown;
  close(db: unknown): void;
  exec(db: unknown, sql: string): void;
  prepare(db: unknown, sql: string): unknown;
  step(stmt: unknown, mode: 0 | 1 | 2, named: object | null, positional: unknown[]): unknown;
  finalize(stmt: unknown): void;
  columns(stmt: unknown): string[];
  inTransaction(db: unknown): boolean;
  sqliteVersion: string;
};

function load(): Native {
  const p = process as unknown as { _linkedBinding?: (name: string) => Native };
  // In der App statisch gelinkt; zum Testen auf dem Mac als Addon (BOOKSHELV_SQLITE_ADDON=/pfad/bookshelv_sqlite.node)
  const addon = process.env.BOOKSHELV_SQLITE_ADDON;
  if (addon) return require(addon) as Native;
  if (!p._linkedBinding) throw new Error('bookshelv_sqlite: kein natives SQLite verfügbar');
  return p._linkedBinding('bookshelv_sqlite');
}

let native: Native | null = null;
const lib = () => (native ??= load());

type Value = null | number | bigint | string | Uint8Array | boolean | undefined;

/** Erstes Argument ein reines Objekt → benannte Parameter, der Rest der Reihe nach */
function split(args: unknown[]): [object | null, unknown[]] {
  const first = args[0];
  if (first && typeof first === 'object' && !Array.isArray(first) && !ArrayBuffer.isView(first)) return [first, args.slice(1)];
  return [null, args];
}

export class StatementSync {
  #db: DatabaseSync;
  #h: unknown;
  #gen: number;
  readonly sourceSQL: string;
  constructor(db: DatabaseSync, sourceSQL: string) {
    this.sourceSQL = sourceSQL;
    this.#db = db;
    this.#gen = db._gen;
    this.#h = lib().prepare(db._handle, sourceSQL);
  }
  /** nach reopen() (Wiederherstellung) neu vorbereiten */
  #handle() {
    if (this.#gen !== this.#db._gen) { this.#h = lib().prepare(this.#db._handle, this.sourceSQL); this.#gen = this.#db._gen; }
    return this.#h;
  }
  run(...args: Value[] | [Record<string, Value>, ...Value[]]) {
    const [n, p] = split(args);
    return lib().step(this.#handle(), 0, n, p) as { changes: number; lastInsertRowid: number };
  }
  get(...args: Value[] | [Record<string, Value>, ...Value[]]) {
    const [n, p] = split(args);
    return lib().step(this.#handle(), 1, n, p) as Record<string, Value> | undefined;
  }
  all(...args: Value[] | [Record<string, Value>, ...Value[]]) {
    const [n, p] = split(args);
    return lib().step(this.#handle(), 2, n, p) as Record<string, Value>[];
  }
  *iterate(...args: Value[] | [Record<string, Value>, ...Value[]]) {
    yield* this.all(...(args as Value[]));
  }
  columns() { return lib().columns(this.#handle()).map(name => ({ name })); }
}

export class DatabaseSync {
  /** @internal */ _handle: unknown;
  /** @internal Zähler je Öffnen – alte Statements bereiten sich danach neu vor */ _gen = 0;
  /** Vorbereitete Anweisungen je SQL-Text wiederverwenden (jede Ausführung setzt sie vollständig zurück) */
  #cache = new Map<string, StatementSync>();

  readonly location: string;
  constructor(location: string) {
    this.location = location;
    this._handle = lib().open(location);
  }
  exec(sql: string) { lib().exec(this._handle, sql); }
  prepare(sql: string): StatementSync {
    let s = this.#cache.get(sql);
    if (!s) {
      s = new StatementSync(this, sql);
      // dynamisch gebaute Abfragen sollen den Speicher nicht füllen
      if (this.#cache.size > 500) this.#cache.clear();
      this.#cache.set(sql, s);
    }
    return s;
  }
  get isTransaction() { return lib().inTransaction(this._handle); }
  get isOpen() { return this._handle !== null; }
  close() {
    this.#cache.clear();
    lib().close(this._handle);
    this._handle = null;
  }
  /** Nur App: Datei schließen (danach darf sie ersetzt werden) … */
  detach() {
    this.#cache.clear();
    if (this._handle) lib().close(this._handle);
    this._handle = null;
    this._gen++;
  }
  /** … und wieder öffnen */
  attach() {
    if (!this._handle) this._handle = lib().open(this.location);
  }
}

export const sqliteVersion = () => lib().sqliteVersion;
