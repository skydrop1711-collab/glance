/**
 * Glance — Telegram Digest & Drafts on G2 (Even Realities, Track 01).
 *
 * Day 4 (27 Nov 2026): write path + voice reply.
 *  - Detail screen, tap = approve AI draft -> POST /reply -> sendMessage.
 *  - Long-press in detail = voice reply: glasses mic (audioControl) ->
 *    audioEvent PCM frames -> POST /stt -> confirm screen -> tap sends.
 *  - One TextContainerProperty 576x288 per screen, re-rendered with
 *    textContainerUpgrade on every state change.
 *
 * Backend base URL is the local backend (127.0.0.1:3000), whitelisted in
 * app.json `network` permission. No secrets in this bundle.
 */
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
  AudioInputSource,
} from '@evenrealities/even_hub_sdk'

const BACKEND_URL = 'http://127.0.0.1:3000'
const FETCH_TIMEOUT_MS = 5000
const REFRESH_MS = 60_000
// Glasses text is large: ~30 chars/line, ~8 lines fit 576x288 at default font
// (ASR template README: 240 chars fit the container).
const LINE_WIDTH = 30
const MAX_LIST_ITEMS = 3

interface DigestItem {
  id: string
  title: string
  summary: string
  draft: string
  needsReply: boolean
  unread: number
  messageCount: number
  lastMessageAt: number
  summarySource: string
}

interface DigestMessage {
  id: string
  from: string
  text: string
  date: number
  outgoing: boolean
}

interface DigestDetail extends DigestItem {
  messages: DigestMessage[]
}

type Screen = 'loading' | 'list' | 'detail' | 'error' | 'sent' | 'listening' | 'confirm'

const VOICE_MAX_MS = 10_000 // max 10 s of mic audio (~320 KB PCM)
const SENT_MS = 2_500 // "Terkirim" confirmation stays this long

const bridge = await waitForEvenAppBridge()

// --- text helpers -----------------------------------------------------------

function truncate(text: string, width: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= width ? t : `${t.slice(0, width - 1)}…`
}

function wrap(text: string, width: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (lines.length >= maxLines) break
    const next = cur ? `${cur} ${w}` : w
    if (next.length > width) {
      if (cur) lines.push(cur)
      cur = w.length > width ? w.slice(0, width - 1) + '…' : w
    } else {
      cur = next
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  // If text overflowed, mark the last line.
  const joined = lines.join(' ').length
  if (joined < text.replace(/\s+/g, ' ').trim().length && lines.length > 0) {
    const last = lines[lines.length - 1]
    lines[lines.length - 1] = last.length >= width ? last.slice(0, width - 1) + '…' : `${last}…`
  }
  return lines
}

// --- state ------------------------------------------------------------------

let screen: Screen = 'loading'
let items: DigestItem[] = []
let selected = 0
let detail: DigestDetail | null = null
let lastError = ''
let lastFetchAt = 0
// Write path + voice reply state.
let sendError = ''
let sentText = ''
let transcribedText = ''
let voiceChunks: Uint8Array[] = []
let voiceStartedAt = 0
let voiceTimer: ReturnType<typeof setTimeout> | null = null
let sentTimer: ReturnType<typeof setTimeout> | null = null

// --- rendering --------------------------------------------------------------

function renderList(): string {
  const lines: string[] = ['Glance · Telegram Digest']
  if (items.length === 0) {
    lines.push('', 'No digests yet.', 'Waiting for Telegram', 'messages…')
  } else {
    for (const [i, it] of items.slice(0, MAX_LIST_ITEMS).entries()) {
      const marker = i === selected ? '▶' : ' '
      const unread = it.unread > 0 ? ` · ${it.unread} new` : ''
      lines.push(`${marker} ${truncate(it.title, LINE_WIDTH - 4)}${unread}`)
      // '✎' (U+270E) has no glyph in the simulator font — '*' marks "has draft".
      const draftMark = it.draft ? ' *' : ''
      lines.push(`  ${truncate(it.summary, LINE_WIDTH - 3)}${draftMark}`)
    }
    if (items.length > MAX_LIST_ITEMS) lines.push(`  +${items.length - MAX_LIST_ITEMS} more`)
  }
  lines.push('Tap open · ↑↓ move · 2× exit')
  return lines.join('\n')
}

function renderDetail(): string {
  if (!detail) return 'Glance\nDetail not loaded.\nTap back · 2× exit'
  const lines: string[] = [truncate(detail.title, LINE_WIDTH)]
  lines.push(...wrap(detail.summary, LINE_WIDTH, 4))
  if (detail.draft) {
    lines.push(...wrap(`Draft: ${detail.draft}`, LINE_WIDTH, 2))
  } else {
    const last = detail.messages[detail.messages.length - 1]
    if (last) lines.push(...wrap(`Last: ${last.from}: ${last.text}`, LINE_WIDTH, 2))
  }
  if (sendError) lines.push(truncate(`! ${sendError}`, LINE_WIDTH))
  // Tap approves the AI draft (day 4); swipe up goes back.
  lines.push(detail.draft ? 'Tap kirim draf · ↑ back' : 'Tap back · 2× exit')
  if (detail.draft) lines.push('Long-press: balas suara')
  return lines.join('\n')
}

function renderSent(): string {
  // Note: '✓' (U+2713) has no glyph in the simulator font (lvgl warning
  // "glyph dsc. not found for U+2713") — plain ASCII so it renders anywhere.
  return ['Terkirim!', ...wrap(sentText, LINE_WIDTH, 3), '', 'Kembali ke list…'].join('\n')
}

function renderListening(): string {
  const secs = Math.max(0, Math.round((Date.now() - voiceStartedAt) / 1000))
  return ['Mendengarkan…', `${secs}s / 10s`, '', 'Tap stop · ↑ batal'].join('\n')
}

function renderConfirm(): string {
  return ['Kamu bilang:', ...wrap(transcribedText, LINE_WIDTH, 4), '', 'Tap kirim · ↑ batal'].join('\n')
}

function renderLoading(): string {
  return 'Glance\nLoading digest…'
}

function renderError(): string {
  return ['Glance', 'Backend offline.', lastError ? truncate(lastError, LINE_WIDTH) : '', 'Tap to retry · 2× exit']
    .filter(Boolean)
    .join('\n')
}

function renderContent(): string {
  switch (screen) {
    case 'list':
      return renderList()
    case 'detail':
      return renderDetail()
    case 'error':
      return renderError()
    case 'sent':
      return renderSent()
    case 'listening':
      return renderListening()
    case 'confirm':
      return renderConfirm()
    default:
      return renderLoading()
  }
}

async function update(): Promise<void> {
  const content = renderContent()
  const ok = await bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: 1, containerName: 'main', content }),
  )
  console.log(`[Glance] screen=${screen} selected=${selected} upgrade=${ok}`)
  console.log(`[Glance] content:\n${content}`)
  // Companion (phone-side) mirror in the WebView.
  const app = document.getElementById('app')
  if (app) {
    app.innerHTML = ''
    const pre = document.createElement('pre')
    pre.textContent = content
    pre.style.textAlign = 'left'
    pre.style.whiteSpace = 'pre-wrap'
    pre.style.fontSize = '16px'
    app.appendChild(pre)
    const meta = document.createElement('div')
    meta.textContent = `screen=${screen} · items=${items.length} · last fetch ${lastFetchAt ? new Date(lastFetchAt).toLocaleTimeString() : 'never'}`
    meta.style.fontSize = '12px'
    meta.style.opacity = '0.7'
    app.appendChild(meta)
  }
}

// --- backend ----------------------------------------------------------------

async function fetchJson<T>(path: string): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

async function loadDigest(): Promise<void> {
  try {
    const data = await fetchJson<{ items: DigestItem[] }>('/digest')
    items = data.items
    selected = Math.min(selected, Math.max(0, items.length - 1))
    lastFetchAt = Date.now()
    screen = 'list'
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    screen = 'error'
    console.log(`[Glance] loadDigest failed: ${lastError}`)
  }
  await update()
}

async function openDetail(id: string): Promise<void> {
  try {
    detail = await fetchJson<DigestDetail>(`/digest/${encodeURIComponent(id)}`)
    screen = 'detail'
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    screen = 'error'
    console.log(`[Glance] openDetail failed: ${lastError}`)
  }
  await update()
}

async function backToList(): Promise<void> {
  detail = null
  sendError = ''
  screen = 'list'
  await update()
  // Refresh in the background so the list is never stale.
  void loadDigest()
}

// --- write path -------------------------------------------------------------

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

async function sendReply(text: string): Promise<void> {
  if (!detail) return
  const itemId = detail.id
  try {
    await postJson<{ ok: boolean; messageId: number }>('/reply', { itemId, text })
    sentText = text
    detail = null
    screen = 'sent'
    await update()
    if (sentTimer) clearTimeout(sentTimer)
    sentTimer = setTimeout(() => {
      if (screen === 'sent') void backToList()
    }, SENT_MS)
  } catch (err) {
    sendError = err instanceof Error ? `Gagal kirim (${err.message})` : 'Gagal kirim'
    console.log(`[Glance] sendReply failed: ${sendError}`)
    screen = 'detail'
    await update()
  }
}

// --- voice reply ------------------------------------------------------------

function clearVoiceTimer(): void {
  if (voiceTimer) {
    clearTimeout(voiceTimer)
    voiceTimer = null
  }
}

async function startVoice(): Promise<void> {
  if (!detail || screen !== 'detail') return
  sendError = ''
  let micOk = false
  try {
    micOk = await bridge.audioControl(true, AudioInputSource.Glasses)
  } catch (err) {
    console.log(`[Glance] audioControl failed: ${err}`)
  }
  if (!micOk) {
    sendError = 'Mic tidak tersedia'
    await update()
    return
  }
  voiceChunks = []
  voiceStartedAt = Date.now()
  screen = 'listening'
  await update()
  clearVoiceTimer()
  voiceTimer = setTimeout(() => {
    if (screen === 'listening') void stopVoice(true)
  }, VOICE_MAX_MS)
}

async function stopVoice(transcribe: boolean): Promise<void> {
  clearVoiceTimer()
  try {
    await bridge.audioControl(false)
  } catch (err) {
    console.log(`[Glance] audioControl(false) failed: ${err}`)
  }
  if (!transcribe || voiceChunks.length === 0) {
    screen = 'detail'
    await update()
    return
  }
  // Concatenate 100 ms PCM frames (16 kHz, 16-bit, mono) into one buffer.
  const total = voiceChunks.reduce((n, c) => n + c.length, 0)
  const pcm = new Uint8Array(total)
  let off = 0
  for (const c of voiceChunks) {
    pcm.set(c, off)
    off += c.length
  }
  voiceChunks = []
  screen = 'loading'
  await update()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 130_000)
    let result: { ok: boolean; text: string }
    try {
      const res = await fetch(`${BACKEND_URL}/stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: pcm.buffer as ArrayBuffer,
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      result = (await res.json()) as { ok: boolean; text: string }
    } finally {
      clearTimeout(timer)
    }
    const text = (result.text ?? '').trim()
    if (!text) {
      sendError = 'Tidak terdengar, coba lagi'
      screen = 'detail'
    } else {
      transcribedText = text
      screen = 'confirm'
    }
  } catch (err) {
    sendError = err instanceof Error ? `STT gagal (${err.message})` : 'STT gagal'
    console.log(`[Glance] stt failed: ${sendError}`)
    screen = 'detail'
  }
  await update()
}

async function cancelVoice(): Promise<void> {
  clearVoiceTimer()
  try {
    await bridge.audioControl(false)
  } catch {
    // Mic may already be closed; ignore.
  }
  voiceChunks = []
  screen = 'detail'
  await update()
}

// --- startup ----------------------------------------------------------------

const mainText = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: renderLoading(),
  isEventCapture: 1,
})

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [mainText],
  }),
)

console.log('Page created:', result === 0 ? 'success' : `failed (${result})`)

// Reads the event type out of one envelope.
//
// CLICK_EVENT is 0, and protobuf omits zero-value fields on the wire, so a
// single tap arrives as an envelope whose `eventType` is `undefined`. The
// default has to be resolved INSIDE the envelope check. Writing
// `event.sysEvent?.eventType ?? OsEventTypeList.CLICK_EVENT` instead would
// read CLICK on events that carry no `sysEvent` at all, so every scroll,
// exit and audio frame would fire the tap handler.
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

// Event routing, critical details (same pattern as the minimal template):
//   • Taps/double-taps/lifecycle come through `event.sysEvent`.
//     Scroll gestures come through `event.textEvent`. Never mix them.
//   • Double-tap → `shutDownPageContainer(1)` is a root-level check: it
//     must fire no matter which envelope the event arrives in, so users
//     can always exit the app.
//   • Check DOUBLE_CLICK_EVENT before CLICK_EVENT.
const unsubscribe = bridge.onEvenHubEvent((event) => {
  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)
  const type = sysType ?? textType
  if (type !== null) console.log(`[Glance] event sys=${sysType} text=${textType} screen=${screen}`)

  if (event.audioEvent) {
    // Mic PCM frame (100 ms, 16 kHz 16-bit mono) — only while recording.
    if (screen === 'listening') {
      voiceChunks.push(event.audioEvent.audioPcm)
    }
    return
  }

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    void bridge.shutDownPageContainer(1)
    return
  }

  if (sysType === OsEventTypeList.SCROLL_TOP_EVENT || textType === OsEventTypeList.SCROLL_TOP_EVENT) {
    // Swipe up: previous item / back / cancel.
    if (screen === 'list') {
      selected = Math.max(0, selected - 1)
      void update()
    } else if (screen === 'detail') {
      void backToList()
    } else if (screen === 'listening') {
      void cancelVoice()
    } else if (screen === 'confirm') {
      screen = 'detail'
      void update()
    } else if (screen === 'sent') {
      void backToList()
    }
    return
  }

  if (sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT || textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    // Swipe down: next item, or next item's detail from detail view.
    if (screen === 'list') {
      selected = Math.min(Math.max(0, items.length - 1), selected + 1)
      void update()
    } else if (screen === 'detail' && items.length > 1) {
      const next = items[(selected + 1) % items.length]
      selected = (selected + 1) % items.length
      void openDetail(next.id)
    } else if (screen === 'detail') {
      void backToList()
    }
    return
  }

  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    if (screen === 'list' && items.length > 0) {
      void openDetail(items[selected].id)
    } else if (screen === 'detail') {
      // Tap approves the AI draft (day 4); without a draft it goes back.
      if (detail?.draft) void sendReply(detail.draft)
      else void backToList()
    } else if (screen === 'error') {
      screen = 'loading'
      void update()
      void loadDigest()
    } else if (screen === 'sent') {
      void backToList()
    } else if (screen === 'listening') {
      void stopVoice(true)
    } else if (screen === 'confirm') {
      void sendReply(transcribedText)
    }
    return
  }

  if (sysType === OsEventTypeList.LONG_PRESS_EVENT) {
    // Long-press in detail = voice reply (day 4, STT).
    if (screen === 'detail') void startVoice()
    return
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    if (screen === 'listening') void bridge.audioControl(false).catch(() => undefined)
    unsubscribe()
  }
})

// Initial load + periodic refresh while on the list screen.
void loadDigest()
setInterval(() => {
  if (screen === 'list') void loadDigest()
}, REFRESH_MS)
// Refresh the recording timer while listening.
setInterval(() => {
  if (screen === 'listening') void update()
}, 500)
