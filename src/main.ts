/**
 * Glance — Telegram Digest & Drafts on G2 (Even Realities, Track 01).
 *
 * Day 3 (25 Nov 2026): digest LIST + DETAIL screens, tap/swipe navigation,
 * data from the Glance backend (GET /digest, GET /digest/:id).
 * One TextContainerProperty 576x288 per screen, re-rendered with
 * textContainerUpgrade on every state change (the pattern proven by the
 * minimal template). Write path (approve draft by tap) is day 4 — here a
 * tap on the detail screen goes back to the list.
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

type Screen = 'loading' | 'list' | 'detail' | 'error'

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
      const draftMark = it.draft ? ' ✎' : ''
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
  lines.push('Tap back · 2× exit')
  return lines.join('\n')
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
  screen = 'list'
  await update()
  // Refresh in the background so the list is never stale.
  void loadDigest()
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

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    void bridge.shutDownPageContainer(1)
    return
  }

  if (sysType === OsEventTypeList.SCROLL_TOP_EVENT || textType === OsEventTypeList.SCROLL_TOP_EVENT) {
    // Swipe up: previous item / back.
    if (screen === 'list') {
      selected = Math.max(0, selected - 1)
      void update()
    } else if (screen === 'detail') {
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
      void backToList()
    } else if (screen === 'error') {
      screen = 'loading'
      void update()
      void loadDigest()
    }
    return
  }

  if (sysType === OsEventTypeList.LONG_PRESS_EVENT) {
    // Long-press = voice reply (day 4, STT). Logged only for now.
    console.log('[Glance] long-press (voice reply not yet implemented)')
    return
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    unsubscribe()
  }
})

// Initial load + periodic refresh while on the list screen.
void loadDigest()
setInterval(() => {
  if (screen === 'list') void loadDigest()
}, REFRESH_MS)
