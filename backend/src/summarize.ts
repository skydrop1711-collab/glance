/**
 * Digest summary + reply draft via local Ollama (no paid API, no key).
 * Model: qwen2.5:3b by default (Ollama on 127.0.0.1:11434).
 * Falls back to an extractive summary when Ollama is unavailable or slow,
 * so the digest endpoints keep working.
 */
import type { StoredMessage } from './store.js';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:3b';

export interface DraftResult {
  summary: string;
  draft: string;
  needsReply: boolean;
  source: 'ollama' | 'extractive';
}

function extractive(messages: StoredMessage[]): DraftResult {
  const texts = messages.map((m) => m.text).filter(Boolean);
  const head = texts.slice(-3).join(' — ');
  const summary =
    head.length > 220 ? `${head.slice(0, 217)}…` : head || 'No messages yet.';
  return { summary, draft: '', needsReply: false, source: 'extractive' };
}

export async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function summarize(
  channelTitle: string,
  messages: StoredMessage[],
): Promise<DraftResult> {
  if (messages.length === 0) {
    return { summary: 'No messages yet.', draft: '', needsReply: false, source: 'extractive' };
  }
  const recent = messages.slice(-10);
  const lines = recent
    .map((m) => `- ${m.from}: ${m.text}`)
    .join('\n');
  const prompt = `You summarize a busy Telegram channel for smart glasses. The user glances at it for 30 seconds.\n\nChannel: ${channelTitle}\nRecent messages:\n${lines}\n\nReply with JSON only, no other text:\n{"summary": "one or two short sentences", "draft": "a short reply draft of 1-2 sentences, or empty string if no reply is needed", "needsReply": true or false}\n\nRules:\n- Write summary AND draft in the SAME language as the messages (Indonesian if the messages are Indonesian, English if they are English).\n- A reply is needed if a message asks a question, requests confirmation, or clearly expects the user to respond.\n- If needsReply is true, draft MUST be a non-empty 1-2 sentence reply in that language. If needsReply is false, draft must be empty.\n- The draft is written AS the user replying in the channel — a direct answer, confirmation, or question back to the group. NEVER write a meta-question about the message itself (forbidden: "Is this relevant to your project?", "Do you want me to summarize this?").\n- Example (Indonesian messages: "Besok demo jam 10 pagi, siapa bisa hadir?") → good draft: "Saya bisa hadir besok jam 10 pagi."`;
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        format: 'json',
        stream: false,
        options: { temperature: 0.3, num_predict: 300 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return extractive(messages);
    const data = (await res.json()) as { response?: string };
    const parsed = JSON.parse(data.response ?? '{}') as {
      summary?: string;
      draft?: string;
      needsReply?: boolean;
    };
    const summary = (parsed.summary ?? '').trim();
    if (!summary) return extractive(messages);
    return {
      summary,
      draft: (parsed.draft ?? '').trim(),
      needsReply: Boolean(parsed.needsReply),
      source: 'ollama',
    };
  } catch {
    return extractive(messages);
  }
}
