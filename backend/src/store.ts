/**
 * Tiny JSON-file store for polled Telegram messages + per-channel digest state.
 * The data directory is gitignored (see repo .gitignore) — it holds live
 * channel content, never credentials.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface StoredMessage {
  id: string; // `${chatId}:${messageId}`
  chatId: number;
  messageId: number;
  chatTitle: string;
  from: string;
  text: string;
  date: number; // unix seconds
  outgoing: boolean; // sent by the bot itself (via POST /reply)
}

export interface ChannelState {
  chatId: number;
  title: string;
  summary: string;
  draft: string;
  needsReply: boolean;
  summaryAt: number; // unix ms, 0 = never generated
  summaryMsgCount: number; // messages covered by the current summary/draft
}

export interface State {
  lastUpdateId: number;
  messages: StoredMessage[];
  channels: Record<string, ChannelState>;
}

const MAX_MESSAGES = 500;

export class Store {
  readonly file: string;
  state: State = { lastUpdateId: 0, messages: [], channels: {} };

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'state.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as State;
      if (parsed && Array.isArray(parsed.messages)) {
        this.state = {
          lastUpdateId: parsed.lastUpdateId ?? 0,
          messages: parsed.messages,
          channels: parsed.channels ?? {},
        };
      }
    } catch {
      // Corrupt state file: start fresh rather than crash the server.
      this.state = { lastUpdateId: 0, messages: [], channels: {} };
    }
  }

  save(): void {
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }

  /** Add a message; returns true if it was new. */
  addMessage(msg: StoredMessage): boolean {
    if (this.state.messages.some((m) => m.id === msg.id)) return false;
    this.state.messages.push(msg);
    if (this.state.messages.length > MAX_MESSAGES) {
      this.state.messages.splice(0, this.state.messages.length - MAX_MESSAGES);
    }
    const key = String(msg.chatId);
    const ch = this.state.channels[key];
    if (!ch) {
      this.state.channels[key] = {
        chatId: msg.chatId,
        title: msg.chatTitle,
        summary: '',
        draft: '',
        needsReply: false,
        summaryAt: 0,
        summaryMsgCount: 0,
      };
    } else if (ch.title !== msg.chatTitle) {
      ch.title = msg.chatTitle;
    }
    return true;
  }

  messagesFor(chatId: number): StoredMessage[] {
    return this.state.messages
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => a.date - b.date || a.messageId - b.messageId);
  }
}

export function dataDir(): string {
  return process.env.DATA_DIR ?? join(dirname(new URL(import.meta.url).pathname), '..', 'data');
}
