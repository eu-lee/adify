# Adify

AI-powered video ad generator for Shopify merchants. Paste a store URL, pick a product, and get a TikTok-ready video ad in under a minute — no filming, editing, or design skills required.

Adify analyzes your product video with Google Gemini, writes a script that matches what's on screen, generates a professional voiceover, composes mood-matched background music, and assembles everything into a polished vertical video with broadcast-quality audio mixing.

[Devpost](https://devpost.com/software/adify)

### Key Features

- **Two ad formats** — Narrated ads (AI voiceover + ducked music) and Music-Only ads (beat-synced cuts + text overlays)
- **Gemini video intelligence** — Script and mood are generated *after* watching the footage, so narration matches the visuals
- **Professional audio** — Sidechain ducking, stereo imaging, and transition SFX
- **AI music generation** — Google Lyria creates unique, mood-matched tracks with known BPM for beat-synced editing
- **Works with any Shopify store** — Just paste the URL, no OAuth or app install needed
- **Multiple durations** — 15s (Stories/Reels), 30s (TikTok), or 60s (YouTube)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Next.js Frontend                    │
│                      (App Router)                       │
│                                                         │
│  Landing Page ─► Product Grid ─► Ad Builder ─► Preview  │
│  (app/page)      (app/products)               (ad-prev) │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────── API Routes ──────────────────────────┐
│                                                         │
│  POST /api/analyze-video   → Compress + Gemini analysis │
│  POST /api/generate-audio  → ElevenLabs TTS narration   │
│  POST /api/generate-music  → Google Lyria music gen     │
│  POST /api/compose-video   → FFmpeg final composition   │
│                                                         │
└────────┬──────────┬──────────┬──────────┬───────────────┘
         │          │          │          │
         ▼          ▼          ▼          ▼
    ┌────────┐ ┌─────────┐ ┌───────┐ ┌────────┐
    │ Gemini │ │Eleven-  │ │ Lyria │ │ FFmpeg │
    │  2.0   │ │ Labs    │ │       │ │        │
    │ Flash  │ │ TTS     │ │(music)│ │(video) │
    └────────┘ └─────────┘ └───────┘ └────────┘

    ┌─────────────────────────────────────────┐
    │             Supabase                    │
    │ PostgreSQL (analytics) + Storage (broll)│
    └─────────────────────────────────────────┘

    ┌─────────────────────────────────────────┐
    │         Shopify Public API              │
    │  Product catalog (no auth required)     │
    └─────────────────────────────────────────┘
```

### Ad Generation Pipeline

```
1. User selects product + ad type + duration
2. Video compressed (640p, CRF 28) + audio analyzed for silence/speech
3. Gemini analyzes video → generates script/cuts + picks voice + determines mood
4. [Narrated] ElevenLabs generates voiceover (per-sentence speed control)
   [Music-Only] Cut boundaries snapped to beat grid
5. Google Lyria generates mood-matched music (fallback: bundled tracks)
6. FFmpeg composes final 1080x1920 MP4:
   - Narrated: video + voice + ducked music + whoosh SFX
   - Music-Only: beat-synced cuts + music + text overlays + riser SFX
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Video Intelligence | Google Gemini 2.0 Flash |
| Voice | ElevenLabs (Multilingual v2, 6 voice profiles) |
| Music | Google Lyria RealTime |
| Video Composition | FFmpeg (sidechain compression, concat, drawtext) |
| Database | Supabase PostgreSQL |
| File Storage | Supabase Storage (b-roll clips) |
| Product Data | Shopify Storefront / Public API |

### Project Structure

```
adify/
├── app/
│   ├── page.tsx                  # Landing page (store connection)
│   ├── products/page.tsx         # Product grid + ad builder
│   ├── ad-preview/page.tsx       # Video preview player
│   └── api/
│       ├── analyze-video/        # Gemini video analysis
│       ├── generate-audio/       # ElevenLabs TTS
│       ├── generate-music/       # Lyria music generation
│       └── compose-video/        # FFmpeg composition
├── lib/
│   ├── gemini.ts                 # Gemini client + prompts
│   ├── elevenlabs.ts             # TTS generation + speed control
│   ├── lyria.ts                  # Music generation (streaming)
│   ├── ffmpeg.ts                 # Video composition commands
│   ├── audio-analysis.ts         # Silence/volume detection
│   ├── beats.ts                  # Beat-snap algorithm
│   ├── supabase.ts               # Supabase client
│   ├── shopify.ts                # Public product API
│   ├── storefront.ts             # Shopify Storefront GraphQL
│   └── adStore.ts                # localStorage state
├── public/
│   ├── music/                    # Fallback background tracks
│   └── sfx/                      # Transition sound effects
└── backend/                      # Optional Express server
    └── src/
        ├── server.ts
        ├── routes/
        └── lib/
```

---

## Setup

### Prerequisites

- **Node.js 18+**
- **FFmpeg** with `drawtext`, `silencedetect`, `sidechaincompress`, and `concat` filters
  ```bash
  # macOS
  brew install ffmpeg

  # Ubuntu/Debian
  sudo apt-get install ffmpeg
  ```

### Install

```bash
git clone <repo-url>
cd adify
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```bash
# --- Required ---

# Google Gemini (video analysis + Lyria music generation)
GEMINI_API_KEY_1=your_gemini_api_key

# ElevenLabs (text-to-speech narration)
ELEVENLABS_API_KEY_1=your_elevenlabs_api_key

# Supabase (analytics + b-roll storage)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# --- Optional ---

# Second ElevenLabs key for redundancy
ELEVENLABS_API_KEY_2=

# Supabase direct connection (analytics DB)
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres

# Custom FFmpeg binary path (defaults to system ffmpeg)
FFMPEG_PATH=/usr/local/bin/ffmpeg

# Backend Express server port (default: 3001)
PORT=3001
```

### External Service Setup

| Service | What to do |
|---------|-----------|
| **Google Gemini** | Create a Google Cloud project, enable the Generative AI API, generate an API key |
| **ElevenLabs** | Create an account at elevenlabs.io, copy your API key from the dashboard |
| **Supabase** | Create a project at supabase.com, grab the URL and anon key from Settings > API |
| **Shopify** | No setup needed — uses the public `/products.json` endpoint |

### Run

```bash
# Development (port 3000)
npm run dev

# Production
npm run build && npm start
```

### Optional: Backend Server

The Express backend at `backend/` mirrors the video composition endpoint and can run standalone:

```bash
cd backend
npm install
npm run dev    # dev (port 3001)
npm run build && npm start  # production
```
