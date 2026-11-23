# PLAN — Heads Up: Even Realities Hackathon (DoraHacks)

> **Status:** PREP selesai 22 Nov 2026, 09:47 WIB. Build penuh **23–29 Nov 2026**.
> **Aturan hackathon yang dipatuhi di sini:** kode aplikasi final TIDAK ditulis sebelum
> 23 Nov. Yang disiapkan sekarang hanya: tooling, skeleton dari official minimal
> template (tanpa perubahan fungsional), verifikasi simulator, riset API, dan rencana ini.
> README repo nanti wajib menyatakan apa yang sudah ada sebelum 23 Nov
> (skeleton template + tooling + dokumen ini).

## 1. Fakta hackathon (terverifikasi live 22 Nov 2026)

- Halaman: https://dorahacks.io/hackathon/even-realities/detail
- Hadiah **$10.000 USDT** (satu hadiah uang per proyek): Grand Prize $2.000;
  tiap track 1st $1.250 + 2nd $500; **Best Telegram integration $1.000**
  (terbuka untuk proyek dari track mana pun); + hingga 10 pasang kacamata G2.
- **Deadline submit: 29 Nov 23:59 waktu Dubai = 19:59 UTC = 30 Nov 02:59 WIB.**
- Demo Day 3 Des 14:00–18:00 Dubai (finalis boleh remote). Kickoff + tech briefing
  23 Nov 12:00 Dubai (= 15:00 WIB). Registrasi buka sejak 18 Nov. Tim 1–4, solo boleh.
- Penjurian: Usefulness on G2 30%, Read and write 25%, Technical execution 20%,
  UX display+voice 15%, Business potential+safety 10%.
- Submit: repo GitHub/GitLab publik + README setup, video demo maks 3 menit
  (simulator atau G2), deskripsi singkat (problem, untuk siapa, cara kerja, track),
  opsional build `.ehpk`.
- Aturan: build selama hackathon; hanya app yang terdaftar di track yang dipilih;
  demo testnet/paper trading/read-only — jangan pegang dana user, jangan beri
  financial advice, jangan commit API key/secret.

## 2. Dokumentasi yang dipakai

| Dokumen | URL |
|---|---|
| Install Even Hub tooling | https://hub.evenrealities.com/docs/get-started/quickstart/install-tools |
| Your First App | https://hub.evenrealities.com/docs/get-started/quickstart/first-app |
| Device APIs (input, audio, IMU) | https://hub.evenrealities.com/docs/build/device-apis |
| Networking (whitelist + CORS) | https://hub.evenrealities.com/docs/build/networking |
| Simulator — README paket npm (docs web me-redirect) | `@evenrealities/evenhub-simulator` 0.9.5, README di `node_modules` |
| SDK reference (community mirror resmi) | https://github.com/even-realities/everything-evenhub/blob/HEAD/plugins/everything-evenhub/skills/sdk-reference/SKILL.md |
| Hackathon | https://dorahacks.io/hackathon/even-realities/detail |
| Telegram Bot API (official) | https://core.telegram.org/bots/api |

Catatan: halaman docs resmi terakhir diperbarui 2026-08-29 dan menyebut versi
lebih lama dari yang live di npm (lihat §3). Versi live npm dipakai sebagai acuan.

## 3. Hasil verifikasi tooling & simulator

| Item | Hasil |
|---|---|
| Node / npm | v24.22.1 / 10.9.4 |
| `evenhub-cli` (global) | **0.2.0 terinstal, jalan** (`evenhub --version` → 0.2.0; `--help` tampil penuh) |
| `evenhub-simulator` (global) | **0.9.5 terinstal**; binary Linux `sim-linux-x64` |
| `even_hub_sdk` (live npm) | 0.0.16 (docs menyebut 0.0.14 — docs ketinggalan) |
| Skeleton | Official minimal template, clone `https://github.com/even-realities/evenhub-templates.git` → `skeleton/` (TANPA perubahan kode) |
| `npm install` di skeleton | OK — 73 packages; SDK 0.0.10 (pin template), Vite 5.4.21, TS 5.9.3 |
| `npm run dev` (Vite) | OK — `VITE ready in 1787 ms`, `http://127.0.0.1:5173/` HTTP 200 |
| `npm run build` | OK — `dist/` ter-build 3,09 dtk |
| `evenhub pack app.json dist` | OK — `evidence/minimal-template-pack-20261122.ehpk` (30.387 byte) |
| Simulator + template render | **TERVERIFIKASI — lihat §3.1** |

### 3.1 Simulator — TERVERIFIKASI (22 Nov 2026, 02:46 UTC / 09:46 WIB)

- **Blocker awal:** binary simulator gagal start:
  `error while loading shared libraries: libwebkit2gtk-4.1.so.0: cannot open shared object file`.
  VM Ubuntu 24.04 tidak punya WebKitGTK.
- **Perbaikan (tidak sepele — dicatat agar build week tidak mengulang):**
  `apt-get update` di VM ini sangat lambat (±8 menit, mirror azure/cogentco)
  dan sempat gagal menemukan paket karena **runtime webkit2gtk ada di pocket
  `noble-security/main`, bukan `universe`** (versi amd64 saat ini
  2.52.6-0ubuntu0.24.04.1; versi 2.44.0-2 sudah tidak ada di pool).
  Solusi yang berhasil: unduh .deb langsung dari `archive.ubuntu.com`
  (pool `main/w/webkit2gtk/`, `main/libs/libsoup3/`, dst) + resolver
  dependensi Python (`/tmp/resolve-webkit.py`, memakai Packages.xz) —
  total ~50 paket (webkit, javascriptcore, soup, gstreamer, mesa 25.2.8,
  libelf, libgbm, dst), semua terinstal & terkonfigurasi (`dpkg -l` bersih,
  `ldd` simulator: 0 missing libs). `apt-get install -y` sendiri GAGAL
  (rc=100, unmet dependencies) karena apt lists VM ini tidak lengkap —
  jangan andalkan apt saat build week; library SUDAH terinstal sekarang.
- **Display:** VM tanpa X server. Simulator dijalankan di bawah `xvfb-run`
  (Xvfb sudah tersedia di `/usr/bin/Xvfb`).
- **Verifikasi headless via Automation API** (simulator 0.7.0+, README paket),
  skrip: `verify-sim.sh`:
  `xvfb-run -a evenhub-simulator http://127.0.0.1:5173 --automation-port 9898`, lalu:
  - `GET /api/ping` → `pong`
  - `GET /api/screenshot/glasses` → PNG **576×288** RGBA (framebuffer kacamata)
  - `POST /api/input {"action":"click"}` → counter template bertambah
  - `GET /api/console` → `[EvenAppBridge] Bridge initialized`,
    `Page created: success`, tanpa error
- **Bukti piksel (bukan sekadar "jalan"):**
  - Awal: 960 piksel opaque — teks **`Hello from G2! / Tap to count ·
    double-tap to exit.`** terbaca jelas (visualisasi alpha di
    `evidence/sim-glasses-before-alpha.png`).
  - Sesudah 1 klik: 784 piksel opaque — teks berubah jadi **`Taps: 1 /
    Tap to count · double-tap to exit.`**
    (`evidence/sim-glasses-after-click-alpha.png`). Jadi alur
    bridge → event → `textContainerUpgrade` → framebuffer **terbukti
    end-to-end**.
  - Catatan: framebuffer glasses memakai channel alpha sebagai nyala piksel
    (RGB selalu hijau murni; piksel mati = alpha 0). Screenshot yang diambil
    <2 detik setelah start masih kosong — tunggu ±5 detik setelah `ping`
    sebelum screenshot pertama (sudah diakomodasi di `verify-sim.sh`).
  - Screenshot webview (`/api/screenshot/webview`) mengembalikan kanvas
    putih kosong di setup ini — tidak dipakai sebagai bukti; framebuffer
    glasses adalah bukti utama.
- **Bukti:** `evidence/sim-verification.log`, `evidence/sim-*.png`,
  `evidence/sim-stdout.log`, `evidence/minimal-template-pack-20261122.ehpk`.
- **Keterbatasan simulator yang dicatat:** audio `audioEvent` di-emit simulator
  (PCM 16 kHz, 16-bit, 100 ms/event) tapi mic asli hanya ada di hardware;
  list-scrolling & font rendering bisa sedikit berbeda dari G2; status event
  tidak di-emit (profil/device di-hardcode). **Tidak ada kacamata G2 di tangan —
  demo video akan direkam dari simulator.**

### 3.2 Catatan versi (keputusan build week)

- Template mem-pin SDK **0.0.10**, CLI 0.1.12, simulator 0.7.2 — semuanya
  ketinggalan dari live npm (SDK 0.0.16, CLI 0.2.0, sim 0.9.5).
- `evenhub pack` memberi warning: `app.json` `min_app_version 2.0.0` di bawah
  floor SDK 0.0.16 (2.2.10) — pack men-stamp 2.2.10.
- **Keputusan:** saat build week, naikkan SDK template ke `@latest` (0.0.16)
  dan samakan `min_sdk_version` di `app.json`; uji ulang di simulator.
  Jangan pakai `--enforce-manual-version` untuk menyembunyikan warning.

## 4. Track & ide terpilih

### 4.1 Keputusan: **TRACK 01 — Messaging & News**

**Nama kerja app: `Glance — Telegram Digest & Drafts on G2`** (nama final saat build).

**Konsep (satu kalimat):** di kacamata, lihat ringkasan 30-detik dari channel/grup
Telegram yang ramai, lalu balas atau teruskan dengan suara — atau setujui draf
balasan yang disiapkan AI — cukup dengan satu tap / ring.

**Alur pakai (60 detik, sesuai kriteria juri "read and write"):**
1. Buka app → layar menampilkan 3–5 item teratas: tiap item = 1 baris judul
   channel + 1 kalimat ringkasan + jumlah pesan belum dibaca.
2. Tap / swipe → buka detail: 3–4 poin penting, muat di layar 576×288.
3. Di item yang butuh balasan: tampilkan **draf balasan AI** (1–2 kalimat).
   Tap = kirim draf; long-press / swipe = dikte balasan sendiri (STT);
   double-tap = keluar (wajib mode 1, dialog konfirmasi sistem).
4. Semua aksi memberi konfirmasi visual 1 baris ("Terkirim ✓") dalam <2 detik.

**Kenapa ide ini (skor terhadap kriteria juri):**
- **Usefulness 30%:** momen nyata setiap hari — channel/grup Telegram ramai,
  orang tidak mau keluarkan HP tiap ada pesan. "Inbox in 30 seconds" adalah
  contoh harfiah dari brief track 01.
- **Read and write 25%:** ini contoh kanonik dari rules ("reply by voice, or
  approve a reply drafted by an AI agent"). Bukan sekadar notifikasi — ada aksi
  tulis yang cepat.
- **Dua jalur hadiah, satu proyek:** Track 01 1st $1.250 + hadiah khusus
  **Best Telegram $1.000** (terbuka untuk semua track; satu proyek hanya bisa
  menang satu hadiah uang, tapi dua jalur = peluang lebih besar).
- **Technical execution 20%:** semua API sudah terverifikasi gratis & bekerja
  (lihat §5); demo penuh bisa jalan di simulator tanpa hardware.
- **Safety 10%:** tanpa uang, tanpa trading, tanpa financial advice; data hanya
  dari channel/grup milik user sendiri; token bot hanya di backend, tidak
  pernah di app.

### 4.2 Kandidat yang dikalahkan: Track 02 — Polymarket + CoinGecko

- **Diverifikasi bekerja:** CoinGecko `/simple/price` HTTP 200 tanpa key,
  CORS `Access-Control-Allow-Origin: *`; Polymarket Gamma
  `gamma-api.polymarket.com/events?active=true&closed=false&order=volume24hr`
  HTTP 200 tanpa key, CORS `*`, market live nyata (contoh: "Trail Blazers vs.
  Knicks", vol 24j $4,2 jt). CLOB `/prices` butuh `tokenID` asli dari Gamma
  (tokenID=1 → 400, wajar).
- **Kenapa kalah:** sisi **write**-nya lemah. Polymarket tidak punya testnet
  betting — "place a bet" berarti uang sungguhan di mainnet (dilarang aturan
  + dilarang preferensi user). Paper-trading palsu akan dinilai juri sebagai
  simulasi, bukan integrasi nyata. Sisa write ("set price alert") terlalu tipis
  untuk 25% bobot read-and-write. Tanpa hadiah khusus. Pasar ticker juga
  pilihan paling generik — semua tim crypto akan buat itu.
- **Status:** CADANGAN. Bila langkah Telegram macet di token/bot (lihat §7),
  pivot ke Track 02 dengan konsep "odds + alert" masih bisa dikejar dari
  hasil verifikasi ini tanpa riset ulang.

### 4.3 Track 03 & 04 — tidak dipilih

- Track 03 (Binance/OKX/dll): semua butuh API key akun exchange + hampir
  pasti KYC/deposit untuk write; risiko dana & regulasi; bukan tanpa friksi.
- Track 04 (Gmail/Calendar/Notion/AI): Google sign-in **tidak bekerja di
  WebView** (aturan resmi); OAuth + pairing-code menambah kompleksitas besar
  untuk 7 hari; ChatGPT/Claude/Gemini butuh API key berbayar. Kalah telak dari
  Telegram yang tokennya gratis dan dibuat dalam 2 menit.

## 5. Kelayakan API (terverifikasi 22 Nov 2026, tanpa daftar akun berbayar)

| API | Butuh key? | Biaya | CORS dari WebView | Status |
|---|---|---|---|---|
| Telegram Bot API (`api.telegram.org/bot<token>/…`) | Token BotFather (gratis) | Gratis | `Access-Control-Allow-Origin: *` (cek header; 401 wajar dengan token palsu) — **tapi token TIDAK BOLEH di app, wajib lewat backend** | ✅ Layak |
| CoinGecko public API | Tidak | Gratis | `*` | ✅ (cadangan T02) |
| Polymarket Gamma API | Tidak | Gratis | `*` | ✅ (cadangan T02) |
| Polymarket CLOB | Tidak (baca harga) | Gratis | — | ⚠️ butuh tokenID asli; write = mainnet, jangan dipakai |
| STT | — | — | — | Lihat §6.3 |

**Detail Telegram Bot API (official, core.telegram.org/bots/api, v10.3):**
`getMe`, `getUpdates` (long polling), `sendMessage`, `getChat` — semua via
`https://api.telegram.org/bot<TOKEN>/<METHOD>`. Bot dibaca/ditulis ke channel
hanya bila dijadikan **admin channel** (hak `can_post_messages`). Rate limit
~1 pesan/detik per chat — cukup untuk demo. Token = satu-satunya kredensial;
bocor = bot bisa dipakai orang lain → simpan di env backend, jangan commit.

**Catatan arsitektur jaringan (docs Networking):** tiap request eksternal harus
(1) masuk `app.json` `network.whitelist` (satu origin penuh, tanpa wildcard)
DAN (2) lolos CORS server tujuan. Karena itu arsitektur memakai **backend
sendiri sebagai proxy** — app hanya whitelist satu origin backend; backend yang
memegang token Telegram dan memanggil `api.telegram.org`. Ini juga yang
diminta aturan hackathon ("route API calls through your own server").

## 6. Arsitektur

```
G2 glasses ──BT── Even App (WebView) ──HTTPS── Backend (Node/TS, server sendiri)
   │                │  app: Vite + TS + @evenrealities/even_hub_sdk      │  ├─ Telegram Bot API (token di env)
   │                │  · 1 text/list container per layar (576×288)       │  ├─ Digest + draf balasan (LLM lokal)
   │                │  · input: tap / double-tap / swipe / long-press    │  ├─ STT (Whisper lokal)
   │                │  · mic → raw PCM → backend                         │  └─ polling getUpdates + cache ringkas
   │                │  · app.json whitelist: HANYA origin backend        │
   └─ mic 4-array, touch temple, R1 ring (opsional) ───────────────────────┘
```

### 6.1 App (WebView, Vite + TypeScript)

- Satu `TextContainerProperty` 576×288 per layar + list container untuk daftar
  digest; `createStartUpPageContainer` sekali di awal (wajib sebelum mic/IMU).
- Navigasi: tap = pilih/buka, swipe up/down = pindah item, double-tap =
  `shutDownPageContainer(1)` (dialog konfirmasi sistem — syarat QA).
- Semua teks pendek: judul ≤ ~40 karakter, isi ≤ 3 baris — desain untuk
  "glance", bukan dashboard.
- Tidak ada secret di bundle app. `app.json` whitelist hanya origin backend.

### 6.2 Backend (Node.js + TypeScript, server cloud agen)

- `GET /digest` → daftar item (channel, ringkasan, unread count, butuh-balas?).
- `GET /digest/:id` → detail + draf balasan.
- `POST /reply {itemId, text}` → `sendMessage` via Bot API → kembali status.
- `POST /stt` ← PCM 16 kHz dari mic kacamata → teks.
- Polling `getUpdates` (interval ~10–20 dtk) + cache; ringkasan dibuat saat
  ada pesan baru, bukan per request.
- Hosting: server cloud agen (pola yang sama seperti build Cortensor —
  mematikan PC user tidak menghentikan kerja). URL publik backend didaftarkan
  di whitelist saat build week.

### 6.3 STT + AI (tanpa API key berbayar)

- **STT:** faster-whisper lokal di backend (gratis, tanpa key, tanpa akun).
  Alternatif bila berat: Deepgram free tier (butuh daftar — jadi rencana B).
  Simulator meng-emit `audioEvent` PCM 16 kHz/16-bit/100 ms — format ini yang
  dipakai kontrak `POST /stt`. Mic asli hanya bisa diuji di hardware (tidak ada).
- **Ringkasan + draf balasan:** LLM lokal via Ollama (pola Cortensor:
  llama3.1 lokal, tanpa key). Kualitas draf singkat 1–2 kalimat sudah cukup
  untuk demo; catat trade-off ini di README (jujur soal keterbatasan).
- **Keputusan yang TIDAK diambil:** OpenAI/Anthropic API (berbayar + butuh
  key + kartu) — tidak sesuai preferensi user (gratis, tanpa deposit).

### 6.4 Data demo (agar juri bisa menilai tanpa akun Telegram user)

- Backend memakai **channel/grup uji milik user** (lihat §7, butuh user).
- Fallback bila channel uji belum siap saat perekaman video: mode demo dengan
  data contoh yang diberi label jelas "DEMO DATA" di layar + README (jangan
  pernah klaim data demo sebagai live). Target utama tetap live.

## 7. ⚠️ FLAG — yang hanya user bisa lakukan

1. **Token bot Telegram (WAJIB, ~5 menit, sebelum/during build week):**
   di Telegram user **@ikyy345** → chat `@BotFather` → `/newbot` → beri nama
   + username `…bot` → salin token → berikan ke agen via Secure Vault
   (JANGAN kirim token di chat biasa). Agen TIDAK BISA membuat bot sendiri
   (butuh akun Telegram user).
2. **Channel/grup uji (WAJIB untuk demo live):** user buat 1 channel Telegram
   uji (atau pakai grup/channel yang sudah ada) → jadikan bot sebagai **admin**
   (hak Post Messages) → kirim beberapa pesan contoh ke channel itu.
   Tanpa ini, app hanya bisa demo dengan data contoh berlabel.
3. **Registrasi hackathon di DoraHacks** (klik Register di halaman hackathon —
   akun DoraHacks user sudah ada: skydrop1711-collab). Ini urusan parent/user,
   bukan prep ini.
4. **Tidak ada kacamata G2** — demo video dari simulator (diperbolehkan aturan).

## 8. Rencana build 23–29 Nov (langkah-demi-langkah)

| Hari | Kerja | Bukti selesai |
|---|---|---|
| **23 Nov (Senin)** | Kickoff 12:00 Dubai / 15:00 WIB — ikuti tech briefing. Terima token bot dari user (§7.1). Naikkan SDK template → 0.0.16, samakan `app.json`. Buat repo publik (parent via browser — GitHub App tidak bisa buat repo personal). Struktur repo + README kerangka (nyatakan: pre-23 Nov = skeleton template + PLAN ini). | Repo publik kosong + README kerangka; simulator jalan dengan SDK baru |
| **24 Nov** | Backend: polling `getUpdates`, `GET /digest`, kirim pesan uji via bot ke channel uji; verifikasi `getMe` + `sendMessage` end-to-end (curl + log). | Log: bot membaca channel uji & mengirim pesan uji |
| **25 Nov** | App: layar daftar digest + detail (data dari backend); navigasi tap/swipe; uji di simulator via automation API (screenshot + input click). | Screenshot glasses 576×288 daftar + detail |
| **26 Nov** | Write path: draf balasan AI (Ollama lokal) + approve-by-tap → `sendMessage`; STT faster-whisper: mic PCM → teks → kirim. Uji end-to-end di simulator (input click → pesan terkirim di Telegram, cek via `getUpdates`/channel). | Pesan balasan TERKIRIM dari aksi tap di simulator |
| **27 Nov** | Polish UX 576×288 (teks pendek, kontras, konfirmasi kirim), handle error/offline, `evenhub pack` → `.ehpk`, uji ulang penuh. | `.ehpk` hasil pack; checklist QA |
| **28 Nov** | Rekam video demo maks 3 menit (simulator + layar + narasi): problem → buka app → digest → draf → tap kirim → pesan muncul di Telegram. Tulis README final + deskripsi submit (problem, untuk siapa, cara kerja, track 01). | Video ≤3 mnt; README final |
| **29 Nov** | Buffer + submit sebelum **30 Nov 02:59 WIB** (deadline 29 Nov 23:59 Dubai). Verifikasi status submit di DoraHacks. JANGAN submit mepet — target submit 29 Nov siang WIB. | Bukti submit DoraHacks |

**Checklist submit:**
- [ ] Repo GitHub publik (README: setup, arsitektur, apa yang pre-23 Nov, cara jalanin)
- [ ] Video demo ≤3 menit (simulator)
- [ ] Deskripsi: problem, untuk siapa, cara kerja, track 01
- [ ] `.ehpk` opsional (bila pack bersih)
- [ ] Tanpa secret di repo (token hanya di env backend; `.gitignore` dicek)
- [ ] Double-tap keluar pakai mode 1 (dialog konfirmasi) — syarat QA
- [ ] `app.json` whitelist hanya origin backend; `min_sdk_version` = SDK yang dipakai
- [ ] Demo read-only/test — tanpa dana, tanpa financial advice

## 9. Risiko & blocker

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Token bot / channel uji belum dari user | Demo tidak bisa live | Minta di awal 23 Nov; fallback data demo berlabel |
| STT lokal (faster-whisper) berat/lambat di server | Balasan suara lambat | Turunkan model ke `tiny/base`; demo utama tetap approve-draf-by-tap (tanpa STT) |
| LLM lokal lambat / draf jelek | Draf tidak meyakinkan | Batasi draf ke template + ringkasan ekstraktif; jaga prompt pendek |
| SDK 0.0.16 vs template 0.0.10 | API berubah, template usang | Naikkan di hari 1, uji ulang simulator sebelum tulis kode app |
| Tanpa hardware G2 | Mic/IMU/tampilan asli tak teruji | Nyatakan di README; andalkan simulator + automation API; video dari simulator |
| `apt` VM lambat | Instalasi tooling makan waktu | Tooling SUDAH terinstal sekarang — tidak perlu ulang saat build week |
| Waktu 7 hari, satu orang | Scope membengkak | Scope dikunci §4.1; Polymarket hanya cadangan, bukan tambahan |

## 10. Struktur workdir

```
~/workspace/dorahacks/even-realities/
├── PLAN.md                  ← dokumen ini
├── verify-sim.sh            ← skrip verifikasi simulator (xvfb + automation API)
├── skeleton/                ← official minimal template, TANPA perubahan kode
│   ├── app.json, package.json, src/main.ts, vite.config.ts, …
│   └── node_modules/ dist/  (hasil verifikasi; dist di-build ulang saat build week)
├── templates-upstream/      ← clone mentah evenhub-templates (referensi)
└── evidence/
    ├── minimal-template-pack-20261122.ehpk
    ├── sim-verification.log
    ├── sim-stdout.log
    └── sim-*.png            (glasses 576×288 + visualisasi alpha + webview)
```

---
*Disiapkan 22 Nov 2026 oleh agen PREP. Build aplikasi final dimulai 23 Nov 2026.*
