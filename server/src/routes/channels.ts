/**
 * Push über andere Apps einrichten (ntfy, Pushover, Telegram) – siehe channels.ts.
 * Die Zugangsdaten für Pushover (App-Token) und Telegram (Bot-Token) trägt die betreibende Person im Admin-Bereich ein.
 */
import { HTTPException } from 'hono/http-exception';
import { requireUser, requireAdmin } from '../auth.ts';
import { router, body, str } from '../util.ts';
import { config } from '../config.ts';
import { setSetting } from '../federation.ts';
import {
  validNtfy, validPushoverKey, setChannel, removeChannel, channelsOf, notifyChannels, pushoverToken, telegramToken,
  telegramBot, telegramLinkCode, telegramPoll, type ChannelKind
} from '../channels.ts';

export const channelRoutes = router();

const KINDS: ChannelKind[] = ['ntfy', 'pushover', 'telegram'];
const lang = (h: string | undefined) => (h === 'en' ? 'en' : 'de');
const localOnly = () => { if (config.local) throw new HTTPException(404, { message: 'Nur mit Konto auf einer Instanz möglich' }); };

channelRoutes.get('/push/channels', async c => {
  const u = requireUser(c);
  localOnly();
  return c.json({
    available: { ntfy: true, pushover: !!pushoverToken(), telegram: await telegramBot() },
    channels: channelsOf(u.id)
  });
});

channelRoutes.put('/push/channels/ntfy', async c => {
  const u = requireUser(c);
  localOnly();
  const url = validNtfy((await body(c)).url);
  if (!url) throw new HTTPException(400, { message: 'Ungültige ntfy-Adresse (https://ntfy.sh/dein-thema)' });
  setChannel(u.id, 'ntfy', url, lang(c.req.header('x-lang')));
  return c.json(channelsOf(u.id));
});

channelRoutes.put('/push/channels/pushover', async c => {
  const u = requireUser(c);
  localOnly();
  if (!pushoverToken()) throw new HTTPException(409, { message: 'Pushover ist auf dieser Instanz nicht eingerichtet' });
  const key = validPushoverKey((await body(c)).key);
  if (!key) throw new HTTPException(400, { message: 'Ungültiger Pushover-Schlüssel (30 Zeichen)' });
  setChannel(u.id, 'pushover', key, lang(c.req.header('x-lang')));
  return c.json(channelsOf(u.id));
});

/** Telegram koppeln: Link zum Bot mit Einmal-Code; danach /check, bis „/start <code>“ angekommen ist */
channelRoutes.post('/push/channels/telegram', async c => {
  const u = requireUser(c);
  localOnly();
  const bot = await telegramBot();
  if (!bot) throw new HTTPException(409, { message: 'Telegram ist auf dieser Instanz nicht eingerichtet' });
  const code = telegramLinkCode(u.id, lang(c.req.header('x-lang')));
  return c.json({ url: `https://t.me/${bot}?start=${code}` });
});

channelRoutes.post('/push/channels/telegram/check', async c => {
  const u = requireUser(c);
  localOnly();
  try { await telegramPoll(); } catch (e) { console.error('Telegram getUpdates:', (e as Error).message); }
  const ch = channelsOf(u.id).find(x => x.kind === 'telegram');
  return c.json({ linked: !!ch && !ch.pending });
});

channelRoutes.delete('/push/channels/:kind', c => {
  const u = requireUser(c);
  const kind = c.req.param('kind') as ChannelKind;
  if (!KINDS.includes(kind)) throw new HTTPException(400, { message: `Erlaubt: ${KINDS.join(', ')}` });
  removeChannel(u.id, kind);
  return c.json(channelsOf(u.id));
});

/** Testnachricht an alle eingerichteten Dienste (ohne Ruhezeit) */
channelRoutes.post('/push/test', async c => {
  const u = requireUser(c);
  localOnly();
  return c.json({ results: await notifyChannels(u.id, true) });
});

// ---------- Admin: Zugangsdaten der Instanz ----------

channelRoutes.get('/admin/push', async c => {
  requireAdmin(c);
  return c.json({
    pushover: !!pushoverToken(), pushoverFromEnv: !!process.env.BOOKSHELV_PUSHOVER_TOKEN,
    telegram: !!telegramToken(), telegramFromEnv: !!process.env.BOOKSHELV_TELEGRAM_BOT_TOKEN, telegramBot: await telegramBot()
  });
});

/** Token setzen (leer = entfernen); gespeicherte Token werden nie zurückgegeben */
channelRoutes.patch('/admin/push', async c => {
  requireAdmin(c);
  const b = await body(c);
  if (b.pushoverToken !== undefined) {
    const t = str(b.pushoverToken, 100);
    if (t && !/^[A-Za-z0-9]{30}$/.test(t)) throw new HTTPException(400, { message: 'Ungültiger Pushover-Token (30 Zeichen)' });
    setSetting('pushover_token', t ?? '');
  }
  if (b.telegramToken !== undefined) {
    const t = str(b.telegramToken, 200);
    if (t && !/^\d+:[A-Za-z0-9_-]{30,}$/.test(t)) throw new HTTPException(400, { message: 'Ungültiger Telegram-Bot-Token' });
    const before = telegramToken();
    setSetting('telegram_token', t ?? '');
    if (t && !(await telegramBot())) {
      setSetting('telegram_token', before ?? '');
      throw new HTTPException(400, { message: 'Telegram kennt diesen Bot-Token nicht' });
    }
    setSetting('telegram_offset', '0');
  }
  return c.json({ pushover: !!pushoverToken(), telegram: !!telegramToken(), telegramBot: await telegramBot() });
});
