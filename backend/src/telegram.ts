/**
 * Telegram Bot API access.
 *
 * The bot token is NEVER stored in this repo, in env vars, or in logs.
 * All Bot API calls go through the registered connector helper
 * (~/workspace/custom-connectors/custom.telegram-bot/bin/telegram-bot.py),
 * which holds the credential in Muse's secure store and swaps it into the
 * request path. This backend only spawns that helper and parses its JSON.
 */
import { execFile } from 'node:child_process';

const HELPER =
  '/home/hatch/workspace/custom-connectors/custom.telegram-bot/bin/telegram-bot.py';

export interface TgResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TgChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
  text?: string;
  caption?: string;
}

export interface TgUpdate {
  update_id: number;
  channel_post?: TgMessage;
  message?: TgMessage;
  edited_channel_post?: TgMessage;
}

function callHelper(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'python3',
      [HELPER, ...args],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(`telegram helper failed: ${(stderr || err.message).trim()}`),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** Call one Bot API method. `params` is JSON-encoded as a single argument. */
export async function tgCall<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
): Promise<TgResponse<T>> {
  const args = params
    ? ['call', method, JSON.stringify(params)]
    : ['call', method];
  const out = await callHelper(args);
  return JSON.parse(out) as TgResponse<T>;
}

export async function tgGetUpdates(
  offset?: number,
): Promise<TgUpdate[]> {
  const params: Record<string, unknown> = { timeout: 0 };
  if (offset !== undefined) params.offset = offset;
  const res = await tgCall<TgUpdate[]>('getUpdates', params);
  if (!res.ok) {
    throw new Error(
      `getUpdates failed: ${res.description ?? 'unknown error'}`,
    );
  }
  return res.result ?? [];
}

export async function tgSendMessage(
  chatId: number,
  text: string,
): Promise<TgMessage> {
  const res = await tgCall<TgMessage>('sendMessage', {
    chat_id: chatId,
    text,
  });
  if (!res.ok || !res.result) {
    throw new Error(
      `sendMessage failed: ${res.description ?? 'unknown error'}`,
    );
  }
  return res.result;
}
