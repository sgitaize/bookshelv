/*
 * Synchrones SQLite für nodejs-mobile (Node 18 ohne node:sqlite, ohne JIT/WebAssembly).
 *
 * Bindet die SQLite des Betriebssystems über N-API an. Die JavaScript-Seite
 * (server/src/mobile/sqlite.ts) baut daraus eine zu node:sqlite passende DatabaseSync-Klasse.
 *
 * In der App wird das Modul statisch mitgelinkt und vor dem Start von Node als „linked binding“
 * registriert (process._linkedBinding('bookshelv_sqlite')). Zum Testen auf dem Mac lässt es sich
 * mit -DBOOKSHELV_ADDON als normales Node-Addon bauen (native/shared/build-addon.sh).
 */
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <node_api.h>

#define CHECK(call) do { if ((call) != napi_ok) return NULL; } while (0)

typedef struct Stmt Stmt;
/* Db-Strukturen werden nie freigegeben (es gibt nur eine Handvoll), damit Statements ihren Besitzer immer finden */
typedef struct { sqlite3 *db; Stmt *stmts; } Db;
struct Stmt { sqlite3_stmt *stmt; Db *owner; Stmt *prev, *next; };

static void unlink_stmt(Stmt *s) {
  if (s->prev) s->prev->next = s->next; else if (s->owner->stmts == s) s->owner->stmts = s->next;
  if (s->next) s->next->prev = s->prev;
  s->prev = s->next = NULL;
}

/* alle Statements finalisieren, dann wirklich schließen (kein „Zombie“, der später die WAL-Datei anfasst) */
static void close_db(Db *d) {
  for (Stmt *s = d->stmts; s; s = s->next) if (s->stmt) { sqlite3_finalize(s->stmt); s->stmt = NULL; }
  if (d->db) sqlite3_close_v2(d->db);
  d->db = NULL;
}

static napi_value throw_sqlite(napi_env env, sqlite3 *db, int rc) {
  napi_value msg, err, code, errcode;
  const char *text = db ? sqlite3_errmsg(db) : sqlite3_errstr(rc);
  napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &msg);
  napi_create_error(env, NULL, msg, &err);
  napi_create_string_utf8(env, "ERR_SQLITE_ERROR", NAPI_AUTO_LENGTH, &code);
  napi_set_named_property(env, err, "code", code);
  napi_create_int32(env, db ? sqlite3_extended_errcode(db) : rc, &errcode);
  napi_set_named_property(env, err, "errcode", errcode);
  napi_throw(env, err);
  return NULL;
}

static char *get_string(napi_env env, napi_value v) {
  size_t len = 0;
  if (napi_get_value_string_utf8(env, v, NULL, 0, &len) != napi_ok) return NULL;
  char *s = malloc(len + 1);
  napi_get_value_string_utf8(env, v, s, len + 1, &len);
  return s;
}

static void db_finalize(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  close_db(data);
}

static void stmt_finalize(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  Stmt *s = data;
  if (s->stmt) sqlite3_finalize(s->stmt);
  unlink_stmt(s);
  free(s);
}

/* open(path) → db */
static napi_value Open(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1], out;
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  char *path = get_string(env, argv[0]);
  if (!path) { napi_throw_type_error(env, NULL, "path must be a string"); return NULL; }
  Db *d = calloc(1, sizeof(Db));
  int rc = sqlite3_open_v2(path, &d->db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, NULL);
  free(path);
  if (rc != SQLITE_OK) { throw_sqlite(env, d->db, rc); sqlite3_close_v2(d->db); d->db = NULL; return NULL; }
  sqlite3_extended_result_codes(d->db, 1);
  CHECK(napi_create_external(env, d, db_finalize, NULL, &out));
  return out;
}

static Db *unwrap_db(napi_env env, napi_value v) {
  Db *d = NULL;
  if (napi_get_value_external(env, v, (void **)&d) != napi_ok || !d || !d->db) {
    napi_throw_error(env, NULL, "database is not open");
    return NULL;
  }
  return d;
}

/* close(db) */
static napi_value Close(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  Db *d = unwrap_db(env, argv[0]);
  if (!d) return NULL;
  close_db(d);
  return NULL;
}

/* exec(db, sql) */
static napi_value Exec(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  Db *d = unwrap_db(env, argv[0]);
  if (!d) return NULL;
  char *sql = get_string(env, argv[1]);
  if (!sql) { napi_throw_type_error(env, NULL, "sql must be a string"); return NULL; }
  int rc = sqlite3_exec(d->db, sql, NULL, NULL, NULL);
  free(sql);
  if (rc != SQLITE_OK) return throw_sqlite(env, d->db, rc);
  return NULL;
}

/* prepare(db, sql) → stmt */
static napi_value Prepare(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2], out;
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  Db *d = unwrap_db(env, argv[0]);
  if (!d) return NULL;
  char *sql = get_string(env, argv[1]);
  if (!sql) { napi_throw_type_error(env, NULL, "sql must be a string"); return NULL; }
  sqlite3_stmt *st = NULL;
  int rc = sqlite3_prepare_v3(d->db, sql, -1, SQLITE_PREPARE_PERSISTENT, &st, NULL);
  free(sql);
  if (rc != SQLITE_OK) return throw_sqlite(env, d->db, rc);
  Stmt *s = calloc(1, sizeof(Stmt));
  s->stmt = st; s->owner = d;
  s->next = d->stmts; if (d->stmts) d->stmts->prev = s; d->stmts = s;
  CHECK(napi_create_external(env, s, stmt_finalize, NULL, &out));
  return out;
}

static int bind_value(napi_env env, sqlite3_stmt *st, int i, napi_value v) {
  napi_valuetype t;
  napi_typeof(env, v, &t);
  switch (t) {
    case napi_undefined:
    case napi_null:
      return sqlite3_bind_null(st, i);
    case napi_boolean: {
      bool b; napi_get_value_bool(env, v, &b);
      return sqlite3_bind_int(st, i, b ? 1 : 0);
    }
    case napi_number: {
      double n; napi_get_value_double(env, v, &n);
      if (n == (double)(sqlite3_int64)n && n >= -9007199254740991.0 && n <= 9007199254740991.0)
        return sqlite3_bind_int64(st, i, (sqlite3_int64)n);
      return sqlite3_bind_double(st, i, n);
    }
    case napi_bigint: {
      int64_t n; bool lossless; napi_get_value_bigint_int64(env, v, &n, &lossless);
      return sqlite3_bind_int64(st, i, n);
    }
    case napi_string: {
      size_t len = 0;
      napi_get_value_string_utf8(env, v, NULL, 0, &len);
      char *s = malloc(len + 1);
      napi_get_value_string_utf8(env, v, s, len + 1, &len);
      return sqlite3_bind_text(st, i, s, (int)len, free);
    }
    case napi_object: {
      bool typed = false, buf = false;
      napi_is_typedarray(env, v, &typed);
      napi_is_buffer(env, v, &buf);
      if (typed || buf) {
        void *data = NULL; size_t len = 0;
        if (buf) napi_get_buffer_info(env, v, &data, &len);
        else {
          napi_typedarray_type tt; size_t n; napi_value ab; size_t off;
          napi_get_typedarray_info(env, v, &tt, &n, &data, &ab, &off);
          len = n; /* nur Uint8Array zu erwarten */
        }
        return sqlite3_bind_blob(st, i, data, (int)len, SQLITE_TRANSIENT);
      }
      return SQLITE_MISMATCH;
    }
    default:
      return SQLITE_MISMATCH;
  }
}

/*
 * Parameter binden: named = Objekt (Schlüssel ohne : @ $), positional = Array.
 * Benannte Platzhalter (:x, @x, $x) kommen aus dem Objekt, alle anderen der Reihe nach aus dem Array.
 */
static bool bind_all(napi_env env, Stmt *s, napi_value named, napi_value positional) {
  sqlite3_stmt *st = s->stmt;
  sqlite3_reset(st);
  sqlite3_clear_bindings(st);
  int count = sqlite3_bind_parameter_count(st);
  uint32_t plen = 0, next = 0;
  bool has_pos = false, has_named = false;
  napi_valuetype nt;
  if (positional) { napi_is_array(env, positional, &has_pos); if (has_pos) napi_get_array_length(env, positional, &plen); }
  if (named) { napi_typeof(env, named, &nt); has_named = nt == napi_object; }
  for (int i = 1; i <= count; i++) {
    const char *name = sqlite3_bind_parameter_name(st, i);
    napi_value v = NULL;
    if (name && name[0] != '?') {
      if (!has_named) { napi_throw_error(env, "ERR_INVALID_STATE", "Named parameter without value object"); return false; }
      bool has = false;
      napi_has_named_property(env, named, name + 1, &has);
      if (!has) {
        char msg[200];
        snprintf(msg, sizeof msg, "Missing named parameter \"%s\"", name + 1);
        napi_throw_error(env, "ERR_INVALID_STATE", msg);
        return false;
      }
      napi_get_named_property(env, named, name + 1, &v);
    } else {
      if (next < plen) napi_get_element(env, positional, next, &v);
      next++;
      if (!v) continue;   /* fehlende Werte bleiben NULL */
    }
    int rc = bind_value(env, st, i, v);
    if (rc != SQLITE_OK) {
      if (rc == SQLITE_MISMATCH) {
        char msg[200];
        snprintf(msg, sizeof msg, "Provided value cannot be bound to SQLite parameter %d.", i);
        napi_throw_type_error(env, "ERR_INVALID_ARG_TYPE", msg);
      } else throw_sqlite(env, sqlite3_db_handle(st), rc);
      return false;
    }
  }
  return true;
}

static napi_value column_value(napi_env env, sqlite3_stmt *st, int i) {
  napi_value v;
  switch (sqlite3_column_type(st, i)) {
    case SQLITE_INTEGER: napi_create_double(env, (double)sqlite3_column_int64(st, i), &v); break;
    case SQLITE_FLOAT: napi_create_double(env, sqlite3_column_double(st, i), &v); break;
    case SQLITE_TEXT: {
      const unsigned char *t = sqlite3_column_text(st, i);
      napi_create_string_utf8(env, (const char *)t, (size_t)sqlite3_column_bytes(st, i), &v);
      break;
    }
    case SQLITE_BLOB: {
      int n = sqlite3_column_bytes(st, i);
      const void *b = sqlite3_column_blob(st, i);
      void *dst; napi_value ab;
      napi_create_arraybuffer(env, (size_t)n, &dst, &ab);
      if (n) memcpy(dst, b, (size_t)n);
      napi_create_typedarray(env, napi_uint8_array, (size_t)n, ab, 0, &v);
      break;
    }
    default: napi_get_null(env, &v);
  }
  return v;
}

static napi_value row_object(napi_env env, sqlite3_stmt *st, int cols) {
  napi_value row;
  napi_create_object(env, &row);
  for (int i = 0; i < cols; i++) napi_set_named_property(env, row, sqlite3_column_name(st, i), column_value(env, st, i));
  return row;
}

static Stmt *unwrap_stmt(napi_env env, napi_value v) {
  Stmt *s = NULL;
  if (napi_get_value_external(env, v, (void **)&s) != napi_ok || !s || !s->stmt || !s->owner->db) {
    napi_throw_error(env, NULL, "statement has been finalized");
    return NULL;
  }
  return s;
}

/* mode: 0 = run → {changes, lastInsertRowid}, 1 = get → row | undefined, 2 = all → rows[] */
static napi_value Step(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value argv[4];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  Stmt *s = unwrap_stmt(env, argv[0]);
  if (!s) return NULL;
  int32_t mode = 0;
  napi_get_value_int32(env, argv[1], &mode);
  if (!bind_all(env, s, argc > 2 ? argv[2] : NULL, argc > 3 ? argv[3] : NULL)) return NULL;
  sqlite3_stmt *st = s->stmt;
  sqlite3 *db = s->owner->db;
  int cols = sqlite3_column_count(st);
  napi_value out = NULL;
  if (mode == 2) napi_create_array(env, &out);
  uint32_t n = 0;
  int rc;
  while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
    if (mode == 1) { out = row_object(env, st, cols); break; }
    if (mode == 2) napi_set_element(env, out, n++, row_object(env, st, cols));
  }
  if (rc != SQLITE_ROW && rc != SQLITE_DONE) {
    sqlite3_reset(st);
    return throw_sqlite(env, db, rc);
  }
  sqlite3_reset(st);
  sqlite3_clear_bindings(st);
  if (mode == 0) {
    napi_value changes, rowid;
    napi_create_object(env, &out);
    napi_create_double(env, (double)sqlite3_changes(db), &changes);
    napi_create_double(env, (double)sqlite3_last_insert_rowid(db), &rowid);
    napi_set_named_property(env, out, "changes", changes);
    napi_set_named_property(env, out, "lastInsertRowid", rowid);
  }
  if (!out) napi_get_undefined(env, &out);
  return out;
}

/* finalize(stmt) */
static napi_value Finalize(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  Stmt *s = NULL;
  if (napi_get_value_external(env, argv[0], (void **)&s) == napi_ok && s && s->stmt) {
    sqlite3_finalize(s->stmt);
    s->stmt = NULL;
  }
  return NULL;
}

/* columns(stmt) → Namen der Ergebnisspalten */
static napi_value Columns(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1], out;
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  Stmt *s = unwrap_stmt(env, argv[0]);
  if (!s) return NULL;
  int cols = sqlite3_column_count(s->stmt);
  napi_create_array_with_length(env, (size_t)cols, &out);
  for (int i = 0; i < cols; i++) {
    napi_value name;
    napi_create_string_utf8(env, sqlite3_column_name(s->stmt, i), NAPI_AUTO_LENGTH, &name);
    napi_set_element(env, out, (uint32_t)i, name);
  }
  return out;
}

/* inTransaction(db) */
static napi_value InTransaction(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1], out;
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  Db *d = unwrap_db(env, argv[0]);
  if (!d) return NULL;
  napi_get_boolean(env, !sqlite3_get_autocommit(d->db), &out);
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    { "open", NULL, Open, NULL, NULL, NULL, napi_default, NULL },
    { "close", NULL, Close, NULL, NULL, NULL, napi_default, NULL },
    { "exec", NULL, Exec, NULL, NULL, NULL, napi_default, NULL },
    { "prepare", NULL, Prepare, NULL, NULL, NULL, napi_default, NULL },
    { "step", NULL, Step, NULL, NULL, NULL, napi_default, NULL },
    { "finalize", NULL, Finalize, NULL, NULL, NULL, napi_default, NULL },
    { "columns", NULL, Columns, NULL, NULL, NULL, napi_default, NULL },
    { "inTransaction", NULL, InTransaction, NULL, NULL, NULL, napi_default, NULL },
  };
  CHECK(napi_define_properties(env, exports, sizeof props / sizeof props[0], props));
  napi_value version;
  napi_create_string_utf8(env, sqlite3_libversion(), NAPI_AUTO_LENGTH, &version);
  napi_set_named_property(env, exports, "sqliteVersion", version);
  return exports;
}

#ifdef BOOKSHELV_ADDON
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
#else
/* Vor node_start() registriert → Node führt das Modul als „linked binding“ */
static napi_module bookshelv_sqlite_module = {
  NAPI_MODULE_VERSION, 0, __FILE__, Init, "bookshelv_sqlite", NULL, { 0 }
};
__attribute__((constructor)) static void bookshelv_sqlite_register(void) {
  napi_module_register(&bookshelv_sqlite_module);
}
#endif
