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

## Status — day 3 (25 Nov 2026): app screens live in the simulator

`src/main.ts` (rewritten from the template) renders the digest on the
glasses, fed live by the backend:

- **List screen:** `Glance · Telegram Digest` — one line per channel
  (title + unread count, one-line summary, ✎ when an AI draft is ready),
  up to 3 items; footer hints (`Tap open · ↑↓ move · 2× exit`).
- **Detail screen:** channel title, full summary (wrapped, ≤4 lines),
  AI draft (`Draft: …`, ≤2 lines), footer hints (`Tap back · 2× exit`).
  Tap on detail goes back to the list; swipe down opens the next item's
  detail (when there is one). Double-tap exits (mode 1, system dialog).
- **Navigation:** tap = open/back, swipe up/down = move selection
  (`SCROLL_TOP`/`SCROLL_BOTTOM` via `textEvent`), double-tap = exit.
  One `TextContainerProperty` 576×288 per screen, re-rendered with
  `textContainerUpgrade`; the phone-side WebView mirrors the same text.
- **Data:** `GET /digest` on load + 60 s refresh on the list screen;
  `GET /digest/:id` when opening a detail; loading + error (tap to retry)
  states. Backend base URL is a constant in `main.ts`
  (`http://127.0.0.1:3000`, whitelisted in `app.json` `network` permission).
- **Rename:** the app is now **Glance** (`com.skydrop.glance`; was
  "Even Hub Minimal" / `com.example.evenhubminimal`).

Verified end-to-end in the simulator (25 Nov, automation API): list
renders from live backend data (2,191 opaque pixels), tap opens the detail
(4,086 px, summary + draft visible), tap returns to the list (byte-identical
screenshot), swipe down/up arrive as `SCROLL_BOTTOM`/`SCROLL_TOP` events,
double-tap exits (framebuffer cleared, 0 opaque pixels), console clean of
errors. Evidence in `../evidence/` (`day3-sim.log`, `day3-list.png`,
`day3-detail.png`, `day3-*-alpha.png`, `glance-day3.ehpk` 37,640 bytes).
Infra note: the VM was replaced again before day 3 — backend, Ollama, and
the global `evenhub` install were all down and had to be restarted
(WebKitGTK reinstalled from the 50 `.deb` files in `../sysdeps/debs/`);
all state survived. Write path (approve draft by tap → `sendMessage`) and
STT are day 4 (26 Nov).

## Status — day 4 (27 Nov 2026): write path + voice reply

`src/main.ts` gains the write path and the voice-reply flow; the backend
gains a real `POST /stt` (was 501):

- **Write path:** on the detail screen, tap approves the AI draft →
  `POST /reply` → `sendMessage` via the bot → `Terkirim!` screen with the
  sent text, auto-return to the list after 2.5 s (tap returns immediately).
  Without a draft, tap on detail just goes back (unchanged behaviour).
  On send failure the detail screen shows the error (`Gagal kirim …`).
- **Voice reply:** long-press on detail starts the glasses mic
  (`audioControl(true, AudioInputSource.Glasses)`) → `Mendengarkan…`
  screen with a seconds counter (auto-stop at 10 s) → tap stops →
  collected `audioEvent` PCM frames (100 ms, 16 kHz 16-bit mono) are
  `POST`ed to `/stt` → confirm screen (`Kamu bilang: …`) → tap sends it
  via `POST /reply`; swipe up cancels (mic closed). Mic unavailable shows
  `Mic tidak tersedia`; empty transcription shows `Tidak terdengar, coba lagi`.
- **STT (backend):** local faster-whisper (`tiny`), persistent daemon
  (`stt-daemon.py`, model loaded once) with one-shot fallback (`stt.py`).
  Accepts raw PCM 16 kHz/16-bit/mono or JSON `{audio: base64}` (WAV/any
  ffmpeg-decodable), 1 MB cap. Measured 27 Nov: daemon cold start ~19 s,
  warm ~3.4 s for an 11 s speech sample; one-shot ~21–24 s; silence →
  empty text. `av` pinned to `==15.1.0` (faster-whisper 1.2.1 breaks with
  `av` 19). `/health` reports `stt: {model, ready}`.
- **Glyph fixes:** `✓` (U+2713) and `✎` (U+270E) have no glyph in the
  simulator font (lvgl `glyph dsc. not found` warnings) — the sent screen
  now says `Terkirim!` and the list marks "has draft" with `*`.
- **Summarize tuning (`backend/src/summarize.ts`):** generation timeout
  120 s → 900 s, `num_predict` 300 → 180. A direct qwen2.5:3b generate
  measured 27 Nov took **578.9 s for ~50 output tokens** on this shared
  1.5-CPU VM under parallel load; the old 120 s timeout fired on every
  summary, so the digest silently fell back to extractive (no draft) —
  which disables the write path entirely. The JSON answer is ~50–90
  tokens, so 180 is plenty.
- **Infra notes:** the VM was replaced again before day 4 — Ollama,
  backend, Vite, the global `evenhub` install, and WebKitGTK were all
  down and had to be restarted/reinstalled (`../sysdeps/debs/`). Restart
  rule learned the hard way: never put `pkill -f "node dist/server.js"`
  and the literal `node dist/server.js` in one command — pkill kills its
  own shell; use the `[n]ode` bracket pattern and separate calls.

Verified end-to-end in the simulator (27 Nov, automation API): list renders
from live backend data, tap opens the detail (draft `Saya akan hadir pada
jam 9 pagi besok.` visible), tap sends it — console shows `screen=sent`
with the sent text, backend logs `reply sent to -1003973222722:
message 18`, `messageCount` 5 → 6, last message is the draft text with
`outgoing=true`. A second manual run sent message 19 the same way (the
sent screen then still read `Terkirim ✓`). A third run with no draft
correctly fell back to tap = back to list. A final re-run against a fresh
Ollama draft (trigger message 22 → draft `Saya akan hadir pada jam 9 pagi
besok.`) re-verified the fixed build end to end: list (Ollama summary + `*`
draft marker), detail, tap → `Terkirim!` screen (screenshot + console log),
backend `reply sent … message 23`, `messageCount` 10 → 11, auto-return to
the list after 2.5 s, zero lvgl glyph warnings. Voice-reply
screens (`listening`/`confirm`) are implemented but **not** testable E2E in
the simulator: the automation API has no long-press or audio-injection
endpoint and the VM has no mic — only the backend `/stt` (real JFK speech,
perfect transcript) and the tap-send flow were tested E2E. Evidence in
`../evidence/` (`day4-sim.log`, `day4-*.png`, `glance-day4.ehpk` 38,566 bytes).

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
