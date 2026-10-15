import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { User } from './auth.ts';

export type AppEnv = { Variables: { user: User | null } };
export const router = () => new Hono<AppEnv>();

export async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    if (b && typeof b === 'object' && !Array.isArray(b)) return b;
  } catch { /* unten */ }
  throw new HTTPException(400, { message: 'Ungültige Anfrage (JSON erwartet)' });
}

export function idParam(c: Context, name = 'id'): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n <= 0) throw new HTTPException(400, { message: 'Ungültige ID' });
  return n;
}

export function str(v: unknown, max = 500): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new HTTPException(400, { message: 'Ungültiger Text' });
  const s = v.trim();
  if (s.length > max) throw new HTTPException(400, { message: `Text zu lang (max. ${max} Zeichen)` });
  return s || null;
}

export function int(v: unknown, min: number, max: number): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HTTPException(400, { message: 'Ungültige Zahl' });
  return n;
}

export function oneOf<T extends string>(v: unknown, values: readonly T[], fallback: T): T {
  if (v === undefined || v === null) return fallback;
  if (!values.includes(v as T)) throw new HTTPException(400, { message: `Erlaubt: ${values.join(', ')}` });
  return v as T;
}

export const notFound = (what = 'Eintrag') => new HTTPException(404, { message: `${what} nicht gefunden` });

/**
 * Alles außer Buchstaben (und optional Ziffern) durch Leerzeichen ersetzen – wie /[^\p{L}\p{N}]+/gu, aber ohne
 * Unicode-Property-Escapes: nodejs-mobile (App) ist ohne ICU gebaut und lehnt \p{…} schon beim Laden ab.
 * Buchstabe = hat Groß-/Kleinform oder gehört zu einer Schrift ohne Groß-/Kleinschreibung (CJK, Kana, Hangul, Arabisch, Hebräisch …).
 */
export function lettersOnly(s: string, digits = true): string {
  let out = '', gap = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const letter = ch.toLowerCase() !== ch.toUpperCase() || ch === 'ß'
      || (cp >= 0x0590 && cp <= 0x06ff) || (cp >= 0x0e00 && cp <= 0x0e7f) || (cp >= 0x3040 && cp <= 0x30ff)
      || (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x20000 && cp <= 0x2fa1f);
    if (letter || (digits && ch >= '0' && ch <= '9')) { if (gap && out) out += ' '; out += ch; gap = false; }
    else gap = true;
  }
  return out;
}
