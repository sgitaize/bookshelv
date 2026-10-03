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
