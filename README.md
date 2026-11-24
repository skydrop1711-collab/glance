# Glance — Telegram Digest & Drafts on G2

> **Even Realities "Heads Up" hackathon (DoraHacks), Track 01 — Messaging & News.**
> See a 30-second digest of your busy Telegram channels and groups on G2
> glasses, then reply or forward by voice — or approve an AI-drafted reply —
> with a single tap. **Prizes:** $10,000 USDT total; Track 01 1st $1,250;
> Best Telegram integration $1,000. **Submit deadline: 30 Nov 2026, 02:59 WIB**
> (29 Nov 23:59 Dubai). Demo Day: 3 Dec 2026.

## Status — day 1 (23 Nov 2026)

This repo is the **day-1 skeleton**: the official Even Hub minimal template
with the SDK upgraded (see below), plus this README and the design document
(`PLAN.md`). The full app (digest screens, backend, AI drafts, STT) is built
23–29 Nov 2026 per the plan.

## Status — day 2 (24 Nov 2026): backend live

`backend/` (Node + TypeScript, no runtime dependencies) is running and
verified end-to-end against the live test channel:

- Polls Telegram `getUpdates` every 15 s; digest store in
  `backend/data/state.json` (gitignored).
- `GET /digest` → digest items; `GET /digest/:id` → detail + AI draft;
  `POST /reply` → `sendMessage` via the bot; `POST /stt` → 501 (day 3).
- Summaries + drafts by local Ollama (`qwen2.5:3b`, no paid API); extractive
  fallback when Ollama is unavailable. Example, live: summary
  *"Glance mengumumkan demo baru untuk jam 9 pagi besok, dengan materi yang
  sudah siap."*, draft *"Saya akan hadir pada jam 9 pagi besok."*
- Test 24 Nov: 2 test messages → digest → `POST /reply` delivered
  (Telegram message 15 in the channel). Evidence in `../evidence/`
  (`backend-day2.log`, `day2-e2e.txt`, `day2-reply.json`).

Notes: the bot token is never in this repo — Bot API calls go through the
registered connector helper (see `backend/README.md`). The bot's own messages
never arrive via `getUpdates` (Telegram behavior), so the live poller-ingest
step still needs one human-posted message in the test channel to be fully
proven. The VM was replaced mid-day (24 Nov ~00:35 UTC): global `evenhub`
0.2.0 was reinstalled, Ollama + backend restarted, state survived.

## What existed before 23 Nov 2026 (build-during-hackathon rule)

Per the hackathon's build-during-hackathon rule, no final app code was
written before 23 Nov 2026. What existed before that date:

- The **official minimal template** from
  `even-realities/evenhub-templates` (unmodified code: one text container,
  `Hello from G2!`, tap-to-count) — the starting point in `src/main.ts`.
- **Tooling verification only**: Even Hub CLI, simulator, `npm install`,
  `npm run build`, `evenhub pack` — no app logic.
- **`PLAN.md`** — the design document (track choice, architecture, API
  feasibility, day-by-day plan). It is included in this repo as the record
  of the pre-23 Nov preparation.

Everything else in this repo (app screens, backend, AI features) is written
during the hackathon, 23–29 Nov 2026.

## Concept

Busy Telegram channels and groups, glanced at in 30 seconds — without taking
out your phone:

1. Open the app → top 3–5 digest items: channel name + one-line summary +
   unread count.
2. Tap / swipe → detail: 3–4 key points, fitting the 576×288 glasses display.
3. On an item that needs a reply: an **AI-drafted reply** (1–2 sentences).
   Tap = send the draft; long-press / swipe = dictate your own reply (STT);
   double-tap = exit (system confirmation dialog, mode 1).
4. Every action confirms in one line ("Terkirim ✓") in under 2 seconds.

## Architecture

```
G2 glasses ──BT── Even App (WebView) ──HTTPS── Backend (Node/TS, own server)
   │                │  app: Vite + TS + @evenrealities/even_hub_sdk      │  ├─ Telegram Bot API (token in env)
   │                │  · 1 text/list container per screen (576×288)       │  ├─ Digest + AI draft replies (local LLM)
   │                │  · input: tap / double-tap / swipe / long-press    │  ├─ STT (Whisper, local)
   │                │  · mic → raw PCM → backend                         │  └─ polling getUpdates + summary cache
   │                │  · app.json whitelist: backend origin ONLY         │
   └─ mic 4-array, touch temple, R1 ring (optional) ───────────────────────┘
```

- **App (WebView):** Vite + TypeScript + `@evenrealities/even_hub_sdk`
  0.0.16. One `TextContainerProperty` 576×288 per screen. No secrets in the
  app bundle; `app.json` whitelists only the backend origin.
- **Backend (Node.js + TypeScript):** `GET /digest`, `GET /digest/:id`,
  `POST /reply`, `POST /stt`. Polls Telegram `getUpdates`, caches summaries.
  **Holds the Telegram bot token in its environment — never in this repo.**
- **STT + AI (no paid keys):** faster-whisper locally for speech-to-text;
  local LLM via Ollama for summaries and reply drafts. No OpenAI/Anthropic
  keys, no paid services.

## Setup

```bash
npm install
npm run dev          # Vite dev server on http://127.0.0.1:5173
```

Run in the simulator:

```bash
npm run simulate     # evenhub-simulator http://localhost:5173
```

Pack for distribution:

```bash
npm run pack         # npm run build && evenhub pack app.json dist → .ehpk
```

Requirements: Node.js 22.18+ (tested on Node v24.22.1), Even Hub CLI
0.2.0 / simulator 0.9.5 for local runs. The simulator needs WebKitGTK
(`libwebkit2gtk-4.1`) on Linux — see `PLAN.md` §3.1.

## Tooling versions (day 1)

| Item | Version |
|---|---|
| `@evenrealities/even_hub_sdk` | **0.0.16** (live npm `@latest`, upgraded from template pin 0.0.10) |
| `app.json` `min_sdk_version` | `0.0.16` |
| `app.json` `min_app_version` | `2.2.10` (the SDK 0.0.16 floor; template's 2.0.0 was below it) |
| Even Hub CLI (local) | 0.1.14 |
| Even Hub simulator | 0.9.5 (binary `sim-linux-x64`) |
| Vite / TypeScript | 5.4.21 / 5.9.3 |

`evenhub pack app.json dist` stamps cleanly: `out.ehpk`, 35,909 bytes,
`min_app_version 2.2.10 (SDK 0.0.16)`.

## Safety & privacy

- No user funds, no trading, no financial advice. Read-only demo data plus
  sending the user's own replies.
- Data only from the user's own channels/groups. The bot token lives in the
  backend environment only — **never commit tokens, API keys, or credentials**
  (see `.gitignore`).
- No hardware G2 on hand — the demo video is recorded from the simulator
  (allowed by the rules).

## Links

- Hackathon: https://dorahacks.io/hackathon/even-realities/detail
- Even Hub docs: https://hub.evenrealities.com/docs
- Telegram Bot API: https://core.telegram.org/bots/api
