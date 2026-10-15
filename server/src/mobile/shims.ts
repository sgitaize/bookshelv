/**
 * Laufzeit-Anpassungen für nodejs-mobile (Node 18, V8 ohne JIT → kein WebAssembly).
 * Muss vor allem anderen geladen werden.
 *
 * - Node 18 holt sich für fetch() den HTTP-Parser von undici als WebAssembly. Ohne WebAssembly stürzt der
 *   Prozess schon beim ersten Zugriff auf Response/Request ab (unbehandelte Ablehnung). Ein Platzhalter, der nie
 *   fertig wird, verhindert das; Response/Request/Headers selbst funktionieren ohne Parser.
 * - fetch() wird durch eine schlanke Umsetzung auf node:http(s) ersetzt (der eingebaute C-Parser braucht kein WASM).
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const g = globalThis as Record<string, unknown>;
if (typeof g.WebAssembly === 'undefined') {
  g.WebAssembly = { compile: () => new Promise(() => {}), instantiate: () => new Promise(() => {}) };
}

type Init = {
  method?: string; headers?: Record<string, string> | Headers | [string, string][]; body?: string | Uint8Array | ArrayBuffer | null;
  signal?: AbortSignal | null; redirect?: 'follow' | 'error' | 'manual';
};

const NULL_BODY = new Set([101, 204, 205, 304]);

function headerObject(h: Init['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) h.forEach((v, k) => { out[k] = v; });
  else if (Array.isArray(h)) for (const [k, v] of h) out[k.toLowerCase()] = v;
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

export async function nodeFetch(input: string | URL | Request, init: Init = {}): Promise<Response> {
  if (input instanceof Request) {
    const req = input;
    init = { method: req.method, headers: req.headers, body: req.body ? new Uint8Array(await req.arrayBuffer()) : null, redirect: req.redirect as Init['redirect'], signal: init.signal ?? req.signal, ...init };
    input = req.url;
  }
  let url = new URL(String(input));
  let method = (init.method ?? 'GET').toUpperCase();
  let body: Buffer | null = init.body == null ? null
    : typeof init.body === 'string' ? Buffer.from(init.body)
    : Buffer.from(init.body instanceof ArrayBuffer ? new Uint8Array(init.body) : init.body);
  const headers = headerObject(init.headers);
  for (let hop = 0; hop < 10; hop++) {
    const res = await once(url, method, headers, body, init.signal ?? undefined);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if ([301, 302, 303, 307, 308].includes(status) && location && init.redirect !== 'manual') {
      res.resume();
      if (init.redirect === 'error') throw new TypeError('fetch failed', { cause: new Error('redirect') });
      url = new URL(location, url);
      if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) { method = 'GET'; body = null; delete headers['content-type']; delete headers['content-length']; }
      continue;
    }
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', resolve);
      res.on('error', e => reject(new TypeError('fetch failed', { cause: e })));
      init.signal?.addEventListener('abort', () => { res.destroy(); reject(init.signal!.reason ?? new DOMException('aborted', 'AbortError')); }, { once: true });
    });
    const h = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (v === undefined) continue;
      for (const one of Array.isArray(v) ? v : [v]) h.append(k, one);
    }
    const data = Buffer.concat(chunks);
    const out = new Response(NULL_BODY.has(status) || method === 'HEAD' ? null : data, {
      status: status < 200 || status > 599 ? 502 : status, statusText: res.statusMessage ?? '', headers: h
    });
    Object.defineProperty(out, 'url', { value: url.toString() });
    Object.defineProperty(out, 'redirected', { value: hop > 0 });
    return out;
  }
  throw new TypeError('fetch failed', { cause: new Error('too many redirects') });
}

function once(url: URL, method: string, headers: Record<string, string>, body: Buffer | null, signal?: AbortSignal) {
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    const mod = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
    if (!mod) return reject(new TypeError('fetch failed', { cause: new Error(`unsupported protocol ${url.protocol}`) }));
    const h: Record<string, string> = { 'accept': '*/*', 'user-agent': 'bookshelv', ...headers };
    if (body) h['content-length'] = String(body.length);
    const req = mod.request(url, { method, headers: h }, resolve);
    const onAbort = () => req.destroy(signal!.reason ?? new DOMException('aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', e => {
      signal?.removeEventListener('abort', onAbort);
      // wie das echte fetch: Netzfehler als TypeError, Abbruch als AbortError/TimeoutError
      reject(e instanceof DOMException ? e : new TypeError('fetch failed', { cause: e }));
    });
    req.end(body ?? undefined);
  });
}

g.fetch = nodeFetch;
