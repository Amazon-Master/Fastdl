# ABB → Real-Debrid iOS PWA

A Progressive Web App that lets you search AudiobookBay.lu and send audiobooks directly
to your Real-Debrid premium account for fast HTTPS download on iOS.

## Quick Start (< 30 minutes)

### 1. Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/abb-rd-pwa
cd abb-rd-pwa
npm install
```

### 2. Local Dev (optional)

Install Vercel CLI: `npm i -g vercel`

```bash
vercel dev
# Opens http://localhost:3000
```

### 3. Deploy to Vercel

```bash
# One-time: connect your GitHub repo at vercel.com/new
# Or directly:
vercel --prod
```

Vercel auto-detects the `/api` folder and deploys serverless functions.
Your app will be live at `https://your-project.vercel.app`.

### 4. Add to iOS Home Screen

1. Open `https://your-project.vercel.app` in **Safari** (not Chrome/Firefox)
2. Tap the **Share** button (box with arrow)
3. Scroll down → **Add to Home Screen**
4. Open the app → Settings tab → paste your RD API key

### 5. Get Your Real-Debrid API Key

Go to [real-debrid.com/apitoken](https://real-debrid.com/apitoken)
while logged into your premium account.

---

## File Structure

```
abb-rd-pwa/
├── api/
│   ├── search.js       # Scrapes ABB search results (title + slug + size)
│   ├── hash.js         # Fetches individual book page for info hash
│   └── rd.js           # Unified Real-Debrid proxy (addMagnet/info/selectFiles/unrestrict)
├── public/
│   ├── index.html      # PWA shell (Alpine.js + Tailwind)
│   ├── app.js          # Main application logic (ES module)
│   ├── crypto.js       # AES-GCM key encryption via IndexedDB + Web Crypto
│   ├── sw.js           # Service worker (offline shell caching)
│   └── manifest.json   # PWA manifest
├── package.json
├── vercel.json         # Routing + CORS headers
└── README.md
```

---

## Architecture

```
iOS Safari (PWA)
    │
    ├── POST /api/search  → scrapes audiobookbay.lu/?s={query}
    │                        returns [{title, slug, size}]
    │
    ├── POST /api/hash    → fetches audiobookbay.lu/{slug}/
    │                        parses table.torrent_infos for info hash
    │                        returns {hash, magnet}
    │
    └── POST /api/rd      → forwards to api.real-debrid.com with Bearer auth
         actions:
           addMagnet      POST /torrents/addMagnet
           info           GET  /torrents/info/{id}
           selectFiles    POST /torrents/selectFiles/{id}
           unrestrict     POST /unrestrict/link
```

## RD Download Flow

1. `/api/hash` → get magnet from ABB book page
2. `rd(addMagnet)` → get RD torrent ID (HTTP 201)
3. Wait 2s → `rd(info)` → list files
4. Filter `.mp3/.m4b/.m4a` → `rd(selectFiles)`
5. Poll `rd(info)` every 6s until `status === "downloaded"`
6. `rd(unrestrict)` on each link → get direct HTTPS URL
7. Download:
   - File < 400 MB: `fetch → Blob → <a download>`
   - File ≥ 400 MB: `window.open()` → Safari native downloader

## API Key Security

- Stored with **AES-GCM 256-bit** encryption via Web Crypto API
- Encryption key is a **non-extractable** `CryptoKey` stored in IndexedDB
  (opaque to JS — cannot be read as raw bytes)
- Key sent to proxy as `X-RD-Auth: Bearer …` header
- Proxy is **stateless** — key is never logged or persisted server-side
- Key is **never sent to ABB** — only RD calls use it

## Known Limitations

| Issue | Workaround |
|-------|-----------|
| ABB changes HTML selectors | `/api/hash.js` has two fallback strategies (table row + magnet link scan) |
| iOS blob crash > 400 MB | Auto-falls back to `window.open()` → Safari native downloader |
| PWA share sheet on install | Use Safari (not standalone mode) to download large files if needed |
| RD rate limit 250 req/min | Polling at 6s intervals; ~10 polls/minute per active download |
| ABB search = 2 HTTP requests | Hash only fetched when user taps "Send to RD" (lazy) |

## Icons

Add your own PNG icons:
- `public/icon-192.png` (192×192)
- `public/icon-512.png` (512×512)

Quick placeholder generation:
```bash
# macOS/Linux with ImageMagick:
convert -size 192x192 xc:#6366f1 -fill white -font Arial -pointsize 36 \
  -gravity center -annotate 0 '📚' public/icon-192.png
```

Or use https://realfavicongenerator.net to generate all iOS icon sizes.

## Legal

This app scrapes publicly accessible metadata from AudiobookBay.lu (no login required).
The user is solely responsible for compliance with applicable copyright laws in their jurisdiction.
