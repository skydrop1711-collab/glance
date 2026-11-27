/**
 * Glance backend — Even Realities, Track 01.
 *
 * Polls Telegram (getUpdates) for the test channel, keeps a digest store,
 * summarizes with local Ollama, and relays replies via the bot.
 *
 * Endpoints:
 *   GET  /                API index
 *   GET  /health          liveness + poll status
 *   GET  /digest          list of digest items (one per chat)
 *   GET  /digest/:id      detail: messages + summary + AI draft
 *   POST /reply           {itemId, text} -> sendMessage via bot
 *   POST /stt             raw 16kHz PCM -> text (local faster-whisper)
 *
 * Env: PORT (default 3000), POLL_MS (default 15000),
 *      OLLAMA_HOST, OLLAMA_MODEL, DATA_DIR.
 * No secrets here: Telegram calls go through the registered connector
 * helper (see telegram.ts); the bot token never touches this process.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Store, dataDir, type StoredMessage } from './store.js';
import { tgGetUpdates, tgSendMessage, type TgUpdate } from './telegram.js';
import { summarize, ollamaAvailable } from './summarize.js';
import { transcribePcm, sttReady, STT_MODEL } from './stt.js';

const PORT = Number(process.env.PORT ?? 3000);
const POLL_MS = Number(process.env.POLL_MS ?? 15_000);

const store = new Store(dataDir());
const startedAt = Date.now();
let lastPollAt = 0;
let lastPollOk = false;
let lastPollError = '';
const summarizing = new Set<string>();

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (Buffer.concat(chunks).length > 64 * 1024) throw new Error('body too large');
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    total += (chunk as Buffer).length;
    if (total > maxBytes) throw new Error('body too large');
  }
  return Buffer.concat(chunks);
}

interface DigestItem {
  id: string;
  title: string;
  summary: string;
  draft: string;
  needsReply: boolean;
  unread: number;
  messageCount: number;
  lastMessageAt: number;
  summarySource: string;
}

function digestItem(chatId: number): DigestItem | null {
  const key = String(chatId);
  const ch = store.state.channels[key];
  if (!ch) return null;
  const msgs = store.messagesFor(chatId);
  const last = msgs[msgs.length - 1];
  return {
    id: key,
    title: ch.title,
    summary: ch.summary || 'Summary pending…',
    draft: ch.draft,
    needsReply: ch.needsReply,
    unread: msgs.filter((m) => !m.outgoing).length,
    messageCount: msgs.length,
    lastMessageAt: last ? last.date * 1000 : 0,
    summarySource: ch.summaryAt ? 'ollama/extractive' : 'none',
  };
}

async function maybeSummarize(chatId: number): Promise<void> {
  const key = String(chatId);
  if (summarizing.has(key)) return;
  const ch = store.state.channels[key];
  if (!ch) return;
  const msgs = store.messagesFor(chatId);
  if (msgs.length === ch.summaryMsgCount && ch.summaryAt) return;
  summarizing.add(key);
  try {
    const result = await summarize(ch.title, msgs);
    ch.summary = result.summary;
    ch.draft = result.draft;
    ch.needsReply = result.needsReply;
    ch.summaryAt = Date.now();
    ch.summaryMsgCount = msgs.length;
    store.save();
    log(`summary ${key}: [${result.source}] ${result.summary.slice(0, 80)}`);
  } finally {
    summarizing.delete(key);
  }
}

function ingestUpdate(u: TgUpdate): StoredMessage | null {
  const raw = u.channel_post ?? u.message ?? u.edited_channel_post;
  if (!raw) return null;
  const text = (raw.text ?? raw.caption ?? '').trim();
  if (!text) return null;
  const chatTitle =
    raw.chat.title ?? raw.chat.username ?? raw.chat.first_name ?? `chat ${raw.chat.id}`;
  const from = raw.from
    ? `${raw.from.first_name ?? ''}${raw.from.username ? ` (@${raw.from.username})` : ''}`.trim() || 'unknown'
    : 'channel';
  const msg: StoredMessage = {
    id: `${raw.chat.id}:${raw.message_id}`,
    chatId: raw.chat.id,
    messageId: raw.message_id,
    chatTitle,
    from,
    text,
    date: raw.date,
    outgoing: Boolean(raw.from?.is_bot),
  };
  return store.addMessage(msg) ? msg : null;
}

async function poll(): Promise<void> {
  lastPollAt = Date.now();
  try {
    const offset = store.state.lastUpdateId
      ? store.state.lastUpdateId + 1
      : undefined;
    const updates = await tgGetUpdates(offset);
    let maxId = store.state.lastUpdateId;
    let added = 0;
    const touched = new Set<number>();
    for (const u of updates) {
      if (u.update_id > maxId) maxId = u.update_id;
      const msg = ingestUpdate(u);
      if (msg) {
        added++;
        touched.add(msg.chatId);
      }
    }
    if (maxId !== store.state.lastUpdateId) {
      store.state.lastUpdateId = maxId;
    }
    if (added > 0) store.save();
    lastPollOk = true;
    lastPollError = '';
    log(`poll: ${updates.length} updates, ${added} new, offset=${store.state.lastUpdateId}`);
    for (const chatId of touched) void maybeSummarize(chatId);
    // Self-healing: (re)generate summaries for any channel whose message
    // count moved past its summary (e.g. a summary failed, or messages
    // arrived while the summarizer was busy).
    for (const key of Object.keys(store.state.channels)) {
      const ch = store.state.channels[key];
      if (store.messagesFor(ch.chatId).length !== ch.summaryMsgCount) {
        void maybeSummarize(ch.chatId);
      }
    }
  } catch (err) {
    lastPollOk = false;
    lastPollError = err instanceof Error ? err.message : String(err);
    log(`poll FAILED: ${lastPollError}`);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      sendJson(res, 200, {
        name: 'Glance backend',
        version: '0.1.0',
        endpoints: ['GET /health', 'GET /digest', 'GET /digest/:id', 'POST /reply', 'POST /stt'],
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        uptime_s: Math.round((Date.now() - startedAt) / 1000),
        lastPollAt,
        lastPollOk,
        lastPollError,
        ollama: await ollamaAvailable(),
        stt: { model: STT_MODEL, ready: sttReady() },
        channels: Object.keys(store.state.channels).length,
        messages: store.state.messages.length,
        lastUpdateId: store.state.lastUpdateId,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/digest') {
      const items = Object.keys(store.state.channels)
        .map((k) => digestItem(Number(k)))
        .filter((i): i is DigestItem => i !== null)
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      sendJson(res, 200, { items });
      return;
    }
    const detailMatch = url.pathname.match(/^\/digest\/(-?\d+)$/);
    if (req.method === 'GET' && detailMatch) {
      const item = digestItem(Number(detailMatch[1]));
      if (!item) {
        sendJson(res, 404, { error: 'digest item not found' });
        return;
      }
      sendJson(res, 200, {
        ...item,
        messages: store.messagesFor(Number(detailMatch[1])).slice(-20),
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/reply') {
      const body = (await readBody(req)) as { itemId?: unknown; text?: unknown };
      const itemId = typeof body.itemId === 'string' ? body.itemId : String(body.itemId ?? '');
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!itemId || !text) {
        sendJson(res, 400, { error: 'itemId and non-empty text are required' });
        return;
      }
      if (text.length > 4096) {
        sendJson(res, 400, { error: 'text exceeds 4096 characters' });
        return;
      }
      const chatId = Number(itemId);
      if (!Number.isFinite(chatId) || !store.state.channels[itemId]) {
        sendJson(res, 404, { error: 'digest item not found' });
        return;
      }
      const sent = await tgSendMessage(chatId, text);
      store.addMessage({
        id: `${chatId}:${sent.message_id}`,
        chatId,
        messageId: sent.message_id,
        chatTitle: store.state.channels[itemId].title,
        from: 'Glance (bot)',
        text,
        date: sent.date,
        outgoing: true,
      });
      store.save();
      log(`reply sent to ${chatId}: message ${sent.message_id}`);
      sendJson(res, 200, { ok: true, messageId: sent.message_id, chatId });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/stt') {
      // Body: raw 16 kHz / 16-bit / mono PCM (application/octet-stream),
      // or JSON {"audio": "<base64 PCM>"}. Empty transcription means
      // "no speech detected" — still a 200, not an error.
      try {
        const contentType = req.headers['content-type'] ?? '';
        let pcm: Buffer;
        if (contentType.includes('application/json')) {
          const body = (await readBody(req)) as { audio?: unknown };
          if (typeof body.audio !== 'string' || !body.audio) {
            sendJson(res, 400, { error: 'JSON body needs an "audio" base64 PCM field' });
            return;
          }
          pcm = Buffer.from(body.audio, 'base64');
        } else {
          pcm = await readRawBody(req, 1024 * 1024);
        }
        if (pcm.length === 0) {
          sendJson(res, 400, { error: 'empty audio body' });
          return;
        }
        const result = await transcribePcm(pcm);
        log(`stt: ${result.duration_s}s -> ${JSON.stringify(result.text.slice(0, 80))}`);
        sendJson(res, 200, { ok: true, model: STT_MODEL, ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`stt FAILED: ${msg}`);
        sendJson(res, 503, { error: 'stt unavailable', detail: msg.slice(0, 200) });
      }
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    log('request error:', err instanceof Error ? err.message : err);
    sendJson(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Glance backend listening on http://127.0.0.1:${PORT}`);
  log(`data dir: ${dataDir()}; poll every ${POLL_MS} ms`);
  void poll();
  setInterval(() => void poll(), POLL_MS);
});
