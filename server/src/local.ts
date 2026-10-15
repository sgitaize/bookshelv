/**
 * Lokal-Modus (App ohne Server): Endpunkte, die andere Menschen oder ein Konto voraussetzen, sind gesperrt.
 * Die Oberfläche blendet sie ohnehin aus; die Sperre hier verhindert halbe Zustände (z. B. Einladungen ins Leere).
 */
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { config } from './config.ts';

/** [Methode oder *, Pfad unter /api] */
const BLOCKED: [string, RegExp][] = [
  ['*', /^\/(setup|login|logout|register)$/],
  ['*', /^\/invites(\/|$)/],
  ['*', /^\/me\/password$/],
  ['DELETE', /^\/me$/],
  ['*', /^\/(fed|federation|friends|remote|remote-loans)(\/|$)/],
  ['*', /^\/reads(\/|$)/],
  ['*', /^\/loan-requests(\/|$)/],
  ['*', /^\/copies\/\d+\/requests$/],
  ['*', /^\/lists\/\d+\/members(\/|$)/],
  ['POST', /^\/reviews\/\d+\/comments$/],
  ['*', /^\/comments\/\d+$/],
  ['GET', /^\/users$/],
  ['*', /^\/users\/\d+\/friend$/],
  ['*', /^\/admin(\/|$)/]
];

export const localGuard: MiddlewareHandler = async (c, next) => {
  if (config.local) {
    const p = c.req.path.replace(/^\/api/, '');
    if (BLOCKED.some(([m, re]) => (m === '*' || m === c.req.method) && re.test(p)))
      throw new HTTPException(403, { message: 'Nur mit Konto auf einer Instanz möglich' });
  }
  await next();
};
