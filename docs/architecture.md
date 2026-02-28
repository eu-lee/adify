# Adify — Architecture

## Overview

Adify is a Shopify-native video ad generator. Merchants paste their store URL, browse their product catalog, pick a product, and get a complete 30-second TikTok-ready ad — auto-scripted, professionally narrated, background music, intelligently edited — in one click.

The video source is the product's own media. If the Shopify listing has a video, we use it. If not, we prompt the merchant to upload their raw footage. Gemini watches the video, writes a script that matches what's on screen, and outputs a precise cut list. No manual editing.

**Demo flow**: Paste store URL → product grid → pick one → (video found or upload prompt) → loading screen → ad plays → download → go back → pick another → generate again.

The second generation is what sells it. Shows it's not a one-trick demo — it's a tool.

## Core User Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Landing Page    │────→│  Connect Store    │────→│  Product Grid   │
│  (hero + CTA)   │     │  (paste URL)      │     │  (catalog view) │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                           │
                                                    pick a product
                                                           │
                                                           ▼
                                                  ┌─────────────────┐
                                                  │ Video available? │
                                                  └───┬─────────┬───┘
                                                 yes  │         │ no
                                                      ▼         ▼
                                              ┌──────────┐ ┌────────────┐
                                              │ Auto-use │ │ Upload     │
                                              │ Shopify  │ │ prompt     │
                                              │ video    │ │ (one file) │
                                              └────┬─────┘ └─────┬──────┘
                                                   │             │
                                                   ▼             ▼
                                            ┌────────────────────────┐
                                            │  Ad Type Selection     │
                                            │  [ Narrated ] [ Music  │
                                            │               Only   ] │
                                            └───────────┬────────────┘
                                                        │
                                                        ▼
                                            ┌────────────────────────┐
                                            │  Generation Pipeline   │
                                            │  (loading screen)      │
                                            └───────────┬────────────┘
                                                        │
                                                        ▼
                                            ┌────────────────────────┐
                                            │  Preview + Download    │
                                            │  "Make Another Ad"     │
                                            └────────────────────────┘
```

## Ad Configuration

### Ad Type
- **Narrated Ad** (default) — Full voiceover ad. Gemini watches the video, writes a script matched to the visuals, picks voice characteristics. ElevenLabs narrates. Background music ducked under the voice.
- **Music-Only Ad** (verbal-less) — No voiceover. Gemini still watches the video to determine optimal cuts and pacing, but instead of a script it outputs cut timings optimized for rhythm/beat sync with the background music. Text overlays (product name, price, CTA) and music tell the story.

### Ad Duration
User picks the target length before generation:
- **15 seconds** — Punchy, fast cuts. ~2-3 sentences (narrated) or ~4-6 cuts (music-only). Best for Instagram Stories/Reels.
- **30 seconds** (default) — Standard TikTok ad. ~4-6 sentences or ~6-10 cuts. The sweet spot.
- **60 seconds** — Longer storytelling. ~8-12 sentences or ~12-18 cuts. Good for YouTube pre-roll or detailed product demos.

Duration is passed to Gemini in the prompt so it calibrates script length, number of cuts, and pacing. Also determines how much of the source video to use and how the background music is trimmed/looped.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 15 (App Router) + TypeScript | Full-stack, API routes for server work |
| Styling | Tailwind CSS v4 | Fast dark-theme UI, no component library needed |
| Shopify Data | Public `/products.json` endpoint | Pull product catalog + media without OAuth |
| Video Intelligence | Google Gemini (`@google/generative-ai`) | Multimodal — watches video, writes script + cut list |
| Voice Narration | ElevenLabs (REST API) | Professional TTS, voice auto-selected by Gemini |
| Background Music | Google Lyria RealTime (`@google/genai`, WebSocket) | AI-generated music matching product mood, exact duration, no licensing |
| Video Composition | FFmpeg (`child_process.execFile`) | Server-side, reliable trim + concat + overlay |
| Analytics DB | Supabase Postgres + `pg` | Track which products get ads generated, video availability |
| State Management | React `useState` | Minimal, no global store needed |

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                          │
│                                                                   │
│  / ──→ /store?url=... ──→ product grid                          │
│                              │                                    │
│                         click product                             │
│                              │                                    │
│                     ┌────────┴────────┐                          │
│                     │ video on listing?│                          │
│                     │  yes → auto-use  │                          │
│                     │  no  → upload UI │                          │
│                     └────────┬────────┘                          │
│                              │                                    │
│                     pick ad type + duration                       │
│                     [Narrated/Music-Only] [15s/30s/60s]           │
│                              │                                    │
│                     /generate/[handle]                            │
│                     (loading → preview → download)                │
│                              │                                    │
│                     "Make Another" → back to grid                 │
│                                                                   │
└──────┬──────────┬───────────┬──────────┬─────────────────────────┘
       │          │           │          │
       ▼          ▼           ▼          ▼
 ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────────┐
 │ GET      │ │ POST     │ │ POST   │ │ POST       │
 │ /api/    │ │ /api/    │ │ /api/  │ │ /api/      │
 │ store/   │ │ analyze- │ │generate│ │ compose-   │
 │ products │ │ video    │ │-audio  │ │ video      │
 └────┬─────┘ └────┬─────┘ └───┬────┘ └─────┬──────┘
      │            │           │             │
      ▼            ▼           ▼             ▼
 ┌──────────┐ ┌────────┐ ┌────────┐  ┌──────────┐
 │ Shopify  │ │ Gemini │ │Eleven  │  │  FFmpeg   │
 │ Store    │ │  API   │ │Labs API│  │ (local)   │
 └──────────┘ └────────┘ └────────┘  └──────────┘
```

## Project Structure

```
adify/
├── app/
│   ├── layout.tsx                      # Root layout, Inter font, dark theme
│   ├── page.tsx                        # Landing page — hero + "Connect Store" CTA
│   ├── globals.css                     # Tailwind v4 + dark color variables
│   ├── store/
│   │   └── page.tsx                    # Product grid (reads store URL from query param)
│   ├── generate/
│   │   └── [handle]/
│   │       └── page.tsx                # Video check → ad type → generation → preview
│   └── api/
│       ├── store/
│       │   └── products/route.ts       # Fetch product catalog from Shopify
│       ├── analyze-video/route.ts      # Gemini: watch video → script + cut list + voice + audioAnalysis
│       ├── generate-music/route.ts     # Lyria RealTime → background music WAV
│       ├── generate-audio/route.ts     # ElevenLabs → narration + per-sentence durations
│       └── compose-video/route.ts      # FFmpeg → final MP4
├── components/
│   ├── StoreConnect.tsx                # Store URL input + connect button
│   ├── ProductGrid.tsx                 # Product cards grid
│   ├── ProductCard.tsx                 # Single product card
│   ├── VideoUpload.tsx                 # Upload prompt (when no Shopify video)
│   ├── AdTypeSelector.tsx             # Narrated vs Music-Only toggle
│   ├── GenerationView.tsx             # Loading states → preview → download
│   └── VideoPlayer.tsx                 # Video player with download button
├── lib/
│   ├── shopify.ts                      # Fetch + parse Shopify products + media
│   ├── gemini.ts                       # Gemini multimodal: video analysis + script + cuts
│   ├── elevenlabs.ts                   # ElevenLabs TTS (voice auto-selected)
│   ├── lyria.ts                        # Lyria RealTime music generation
│   ├── beats.ts                        # Beat-snap logic for music-only cuts (from Lyria BPM)
│   ├── audio-analysis.ts              # Source video audio intelligence (silence, speech, levels)
│   └── ffmpeg.ts                       # FFmpeg: trim, concat, overlay, ducking, spatial, SFX, compose
├── public/
│   └── sfx/                            # Transition sound effects
│       ├── whoosh-1.mp3                # ~0.2-0.3s each
│       ├── whoosh-2.mp3
│       ├── whoosh-3.mp3
│       └── riser.mp3                   # Short riser for CTA moments
├── lib/
│   ├── ...
│   ├── db.ts                           # pg Pool (Supabase connection)
│   └── analytics.ts                    # trackGeneration() — insert row on each ad generation
├── .env.local                          # API keys + DATABASE_URL
└── package.json
```

## Data Flow

### Shopify Product Fetching

```
Store URL (e.g. "cool-gadgets.myshopify.com")
  → GET {storeUrl}/products.json?limit=50
  → Parse each product: { id, handle, title, description, images[], video_url?, price }
  → Flag which products have video media attached
  → Display as product grid (badge on products with video)
```

Shopify product media can include video. The `/products.json` response includes media references — check for `media` array entries with `media_type: "video"`.

### Video Source Resolution

When a product is selected:
1. **Shopify has video** → Download/stream the product video directly from Shopify CDN
2. **No video on listing** → Show upload UI: "Upload a short video of your product (up to 60 seconds)"
3. User uploads one raw, unedited video file

Either way, the pipeline receives a single video file as input.

### Gemini Video Analysis (the core intelligence)

Gemini is multimodal — it can watch the video. This is the key insight: Gemini writes the script **after seeing the footage**, so the narration naturally matches what's on screen.

**For narrated ads**, the prompt:
```
Watch this product video. You are an expert TikTok/Instagram ad copywriter.

Product: {title}
Description: {description}
Price: {price}
Target duration: {duration} seconds

Write a {duration}-second narrated video ad. For each sentence of narration, specify
which timestamp range from the source video best matches what's being said.

Also determine the ideal voice characteristics for this product's target audience.

Return JSON:
{
  "adType": "narrated",
  "mood": "energetic|luxury|playful|professional|emotional|minimalist",
  "voice": {
    "gender": "female|male",
    "age": "young|middle|mature",
    "tone": "warm|authoritative|excited|calm|friendly",
    "elevenlabs_voice_id": "JBFqnCBsd6RMkjVDRZzb"
  },
  "sentences": [
    {
      "text": "Ever struggle with tangled cables?",
      "videoStart": 0.0,
      "videoEnd": 4.2
    },
    {
      "text": "Meet the MagSnap — it clicks into place.",
      "videoStart": 12.5,
      "videoEnd": 18.1
    }
  ]
}
```

Gemini sees "hands fumbling with cables" at 0-4s and writes a pain-point line for it. It sees "the product snapping together" at 12-18s and writes the hero moment. **The script is written to match the footage by design.**

**For music-only ads**, the prompt:
```
Watch this product video. Create a {duration}-second music-only video ad
(no voiceover). Determine the best cuts based on visual content.

Product: {title}
Description: {description}
Price: {price}
Target duration: {duration} seconds

Return JSON:
{
  "adType": "music_only",
  "mood": "energetic|luxury|playful|professional|emotional|minimalist",
  "cuts": [
    { "videoStart": 0.0, "videoEnd": 3.5, "textOverlay": null },
    { "videoStart": 8.2, "videoEnd": 12.0, "textOverlay": "MagSnap Pro" },
    { "videoStart": 15.0, "videoEnd": 19.5, "textOverlay": "$29.99" },
    { "videoStart": 22.0, "videoEnd": 26.0, "textOverlay": null },
    { "videoStart": 5.0, "videoEnd": 8.0, "textOverlay": "Shop now at example.com" }
  ]
}
```

Note: Gemini's cut timestamps are approximate — they describe *what* to show, not precise timing. The actual cut points are snapped to the nearest beat of the background music track (see Beat-Synced Editing below).

### ElevenLabs Voice Auto-Selection

Gemini picks the voice, not the user. Based on product type and target audience:

| Product Vibe | Voice Selection |
|-------------|----------------|
| Luxury/premium | Mature, warm, authoritative |
| Playful/youth | Young, excited, friendly |
| Professional/B2B | Middle-aged, calm, trustworthy |
| Emotional/storytelling | Warm, intimate, gentle |

Gemini outputs an `elevenlabs_voice_id` from a known set:
- `JBFqnCBsd6RMkjVDRZzb` — Rachel (warm, professional female)
- `pNInz6obpgDQGcFmaJgB` — Adam (deep, authoritative male)
- `EXAVITQu4vr4xnSDxMaL` — Bella (young, friendly female)
- `ErXwobaYiN019PkySvjV` — Antoni (warm, calm male)
- `MF3mGyEYCl7XYWbV9V6O` — Elli (young, energetic female)
- `TxGEqnHWrfWFTfGW9XjX` — Josh (deep, narrative male)

The voice decision is fully automatic. User just clicks "generate."

### Narration Generation

For narrated ads, each sentence is sent to ElevenLabs individually:
1. Sentence 1 → ElevenLabs → audio_1.mp3 (know exact duration)
2. Sentence 2 → ElevenLabs → audio_2.mp3 (know exact duration)
3. ...

This gives us precise per-sentence durations, which we need to trim video segments to match. Then concat all audio chunks into one narration track.

### Lyria RealTime Music Generation

Background music is generated per-ad using Google's Lyria RealTime model (`lyria-realtime-exp`), accessed via the Gemini API. No bundled tracks, no licensing concerns — every ad gets unique, mood-matched music generated to the exact duration needed.

**How it works** (`lib/lyria.ts`):

1. Gemini's video analysis outputs a `mood` (energetic, luxury, playful, etc.)
2. Mood is mapped to a Lyria weighted prompt + config:

```typescript
const moodToLyria: Record<string, { prompt: string, bpm: number, density: number, brightness: number }> = {
  energetic:    { prompt: "upbeat electronic pop, driving beat, energetic",     bpm: 128, density: 0.8, brightness: 0.7 },
  luxury:       { prompt: "elegant piano, ambient, sophisticated cinematic",    bpm: 72,  density: 0.3, brightness: 0.4 },
  playful:      { prompt: "fun ukulele, upbeat acoustic, lighthearted pop",     bpm: 110, density: 0.6, brightness: 0.8 },
  professional: { prompt: "clean corporate, ambient technology, modern",        bpm: 90,  density: 0.4, brightness: 0.5 },
  emotional:    { prompt: "emotional piano strings, cinematic, inspirational",  bpm: 68,  density: 0.3, brightness: 0.3 },
  minimalist:   { prompt: "minimal ambient, soft electronic, clean sparse",     bpm: 80,  density: 0.2, brightness: 0.4 },
};
```

3. Connect via WebSocket, stream audio for the target duration (15/30/60s)
4. Collect raw 16-bit PCM chunks (48kHz stereo), convert to WAV/MP3 for FFmpeg
5. Since we control the BPM, the beat map is mathematically derived — no analysis needed:
   ```
   beat_interval = 60 / bpm
   beats = [0, beat_interval, beat_interval*2, ...]
   ```

**Output**: A unique background track, exact duration, known BPM → deterministic beat map for free.

**Latency**: Lyria streams in 2-second chunks with ~2s control latency. A 30s track takes ~4-6s to fully generate (chunks arrive in near-real-time). This runs in parallel with ElevenLabs narration, so it doesn't add to total pipeline time.

**Fallback**: Bundle 2-3 royalty-free tracks in `/public/music/` as backup if Lyria is unavailable or rate-limited.

### Beat-Synced Editing (Music-Only Ads)

Every visual cut in a music-only ad lands on a beat. This is what makes TikTok ads feel professionally edited — transitions sync with the rhythm.

**How it works:**

Since Lyria generates music at a known BPM, the beat map is computed mathematically — no audio analysis needed:
```typescript
function generateBeatMap(bpm: number, durationSeconds: number): number[] {
  const interval = 60 / bpm;
  const beats: number[] = [];
  for (let t = 0; t < durationSeconds; t += interval) {
    beats.push(Math.round(t * 1000) / 1000);
  }
  return beats;
}
// bpm=128 → beats at [0, 0.469, 0.938, 1.406, 1.875, ...]
```

**At composition time** (`lib/beats.ts`):
1. Compute beat map from Lyria's BPM
2. Take Gemini's approximate cut list (which describes *what* to show)
3. Snap each cut boundary to the nearest beat timestamp
4. Adjust cut durations so every transition falls exactly on a beat
5. Pass the beat-snapped cut list to FFmpeg

Example: Gemini says cut at 3.5s, BPM=128 so nearest beats are at 3.28s and 3.75s → snap to 3.28s.

For higher energy moods (energetic, playful), cuts land on every beat or every 2 beats for fast pacing. For slower moods (luxury, emotional, minimalist), cuts land every 4-8 beats for a more cinematic feel.

### Sidechain Audio Ducking (Narrated Ads)

Background music doesn't just play at a flat low volume — it **dynamically ducks when the voice is present** and swells back up in the gaps between sentences. This is the same sidechain compression technique used in professional broadcast and podcast production.

**FFmpeg implementation** using `sidechaincompress`:
```
[narration][music]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=1000
```

- `threshold=0.02` — trigger ducking at very low voice levels (catches soft speech)
- `ratio=6` — aggressive compression (music drops ~15dB when voice is active)
- `attack=200` — 200ms attack (music ducks quickly but not jarringly when voice starts)
- `release=1000` — 1000ms release (music fades back up smoothly after voice stops)

**Result**: Between sentences, music swells to ~80% volume, giving the ad breathing room and emotional moments. When narration resumes, music drops back under the voice. Judges at an audio hackathon will hear this immediately — it's the difference between amateur and broadcast quality.

This replaces the naive `volume=0.15` flat reduction from the simple pipeline.

### Transition SFX

Every visual cut gets a short whoosh sound effect (~0.2-0.3s). This is what separates amateur cuts from professional edits — the ear expects a sonic cue when the eye sees a transition. Every TikTok ad editor does this.

**Implementation**: Bundle 3-4 short SFX files in `/public/sfx/`. At composition time, for each cut point in the timeline, insert a whoosh using FFmpeg's `adelay` filter positioned at the exact transition frame. Cycle through different whoosh variants so they don't feel repetitive.

```
# For a cut at t=3.28s, insert whoosh-1.mp3 starting at 3.18s (slightly before the cut)
[3:a]adelay=3180|3180[sfx0];
# For a cut at t=7.5s, insert whoosh-2.mp3
[4:a]adelay=7400|7400[sfx1];
# Mix all SFX into one track, then into the final mix
[sfx0][sfx1]amix=inputs=2[sfx_mix]
```

For music-only ads, SFX are mixed at full volume. For narrated ads, SFX are mixed at ~50% to avoid competing with the voice. An optional `riser.mp3` (short upward sweep) is placed 1-2s before the final CTA for dramatic buildup.

### Source Video Audio Intelligence

Before Gemini even sees the video, analyze the source audio track to make smarter composition decisions. This is `lib/audio-analysis.ts`.

**What we detect:**

1. **Silence regions** — `ffmpeg -af silencedetect=noise=-30dB:d=0.5` → JSON array of `{ start, end }` silent sections. Fed to Gemini as hints: "these are natural pause/cut points in the footage."

2. **Volume profile** — `ffmpeg -af volumedetect` → peak and mean volume. Used to set appropriate music levels relative to source audio.

3. **Speech detection** — Check if the source video contains speech. If it does:
   - **Narrated ads**: Strip source audio entirely (avoid two voices talking over each other)
   - **Music-only ads**: Option to keep source audio as a low ambient bed for authenticity
   - Detection: if mean volume > -30dB and there are few silence regions, likely has speech

4. **Ambient audio extraction** — For product videos with interesting ambient sound (coffee machine brewing, fabric rustling, mechanical clicks), keep source audio as a subtle bed mixed under narration/music at ~10% volume. Adds authenticity.

**Gemini integration**: The silence regions are passed to Gemini as part of the prompt:
```
Source video audio analysis:
- Silent regions: [0.0-0.5s, 4.2-4.8s, 12.0-12.3s, ...]
- Contains speech: false
- Mean volume: -22dB

Use silent regions as preferred cut points when possible.
```

This gives Gemini better cut decisions — it can align visual transitions with natural audio pauses in the source footage.

### Spatial Stereo Mix

Basic spatial separation applied to the final audio mix. Not full HRTF (that's the roadmap) but audible stereo positioning that's noticeable on headphones and demo-able.

*Note: `stereotools` uses `mode=ms:slevel=N` to control side-channel level in M/S mode — this is the correct parameter for stereo widening. The `widening` parameter name does not exist in FFmpeg's stereotools filter.*

**Three-layer spatial placement:**

| Layer | Position | Treatment |
|-------|----------|-----------|
| Voice (narration) | Dead center, dry mono | No processing — clarity is king |
| Music | Wide stereo | `stereotools=mode=ms:slevel=1.5` — pushes music to the sides |
| SFX (whooshes) | Alternating L/R pan | Odd cuts pan left, even cuts pan right — adds movement |

**FFmpeg implementation:**
```
# Voice stays center (already mono from ElevenLabs)
[voice]aformat=channel_layouts=stereo[vc];

# Widen music stereo field
[music]stereotools=mode=ms:slevel=1.5[mw];

# Pan SFX alternating left/right
[sfx0]pan=stereo|c0=1.5*c0|c1=0.5*c0[sfx_l];
[sfx1]pan=stereo|c0=0.5*c0|c1=1.5*c0[sfx_r];
```

**Result**: Put on headphones — voice sits in your head (center), music wraps around you (wide), whooshes dart left and right with each cut. Subtle but immediately noticeable. Judges will hear it.

For music-only ads (no voice), the spatial treatment is more aggressive: music gets full width, SFX get harder pans, and the overall mix has more stereo depth since there's no center voice to protect.

### API Route Details

**`GET /api/store/products?url={storeUrl}`**
- Fetches `{storeUrl}/products.json`
- Returns: `{ products: [{ id, handle, title, description, image, price, hasVideo, videoUrl }] }`

**`POST /api/analyze-video`**
- Input: FormData with `video` (file), `product` (JSON: title, description, price), `adType` ("narrated" | "music_only"), `duration` (15 | 30 | 60)
- Runs `analyzeSourceAudio()` internally (no separate audio analysis route needed — the file is already here)
- Uploads video to Gemini, runs multimodal analysis with target duration and audio hints
- Returns: `{ mood, bpm, voice?, sentences?, cuts?, audioAnalysis: { silenceRegions, meanVolume, hasSpeech } }`

**`POST /api/generate-music`**
- Input: JSON `{ mood: string, durationSeconds: number }`
- Calls `lib/lyria.ts` — WebSocket-based, must be `runtime = 'nodejs'`, `maxDuration = 120`
- Returns: `audio/wav` blob
- Fire in parallel with `/api/generate-audio` after mood is known from analyze-video

**`POST /api/generate-audio`**
- Input: `{ sentences: string[], voiceId: string }`
- Sends all sentences to ElevenLabs in parallel, measures duration of each chunk via `ffprobe`
- Returns: `{ chunks: [{ durationMs: number }], fullAudioBase64: string }`

**`POST /api/compose-video`**
- Input: FormData with `video` (source), `narration?` (audio — narrated only), `music` (WAV from generate-music), `cutList` (JSON), `chunkDurations` (JSON — narrated only), `audioAnalysis` (JSON — forwarded from analyze-video), `adType`, `bpm`
- SFX paths are hardcoded server-side (`public/sfx/`) — not passed from client
- FFmpeg executes the cut list
- Output: Raw `video/mp4` blob; cleans up `/tmp/adify-{timestamp}/` after responding
- `runtime = 'nodejs'`, `maxDuration = 120`

### FFmpeg Composition Pipeline

**Narrated ad — full audio pipeline:**
```
Source video
  → analyze source audio (silence regions, speech detection, volume)
  → feed silence hints to Gemini
  → trim segments per Gemini cut list (matched to sentence durations — if Gemini clip is shorter than ElevenLabs audio, hold last frame with `tpad=stop_mode=clone`)
  → concat all video segments
  → scale to 1080x1920 (9:16 TikTok) with letterboxing
  → AUDIO:
    → narration: center mono (dry)
    → music: stereo-widened (stereotools mode=ms:slevel=1.5)
    → sidechain duck music under voice (swells in sentence gaps)
    → insert whoosh SFX at each cut point (alternating L/R pan)
    → mix all audio layers
  → libx264 ultrafast + AAC → output.mp4
```

**Music-only ad — full audio pipeline:**
```
Source video
  → analyze source audio (silence regions → hints for Gemini)
  → Gemini cut list snapped to beat map timestamps
  → trim segments at beat-aligned boundaries
  → concat (every transition lands on a beat)
  → scale to 1080x1920
  → burn in text overlays (drawtext) where specified
  → AUDIO:
    → music: full stereo-widened
    → insert whoosh SFX at each beat-synced cut (hard L/R pans)
    → optional: source ambient audio bed at ~10% volume
    → mix all audio layers
  → libx264 ultrafast + AAC → output.mp4
```

FFmpeg narrated example (ducking + SFX + spatial):
```bash
ffmpeg \
  -i source.mp4 \
  -i narration.mp3 \
  -i music.mp3 \
  -i whoosh-1.mp3 \
  -i whoosh-2.mp3 \
  -filter_complex '
    # --- VIDEO ---
    [0:v]split=3[v0][v1][v2];
    [v0]trim=0:4.2,setpts=PTS-STARTPTS[seg0];
    [v1]trim=12.5:18.1,setpts=PTS-STARTPTS[seg1];
    [v2]trim=22:26,setpts=PTS-STARTPTS[seg2];
    [seg0][seg1][seg2]concat=n=3:v=1:a=0[vc];
    [vc]scale=1080:1920:force_original_aspect_ratio=decrease,
        pad=1080:1920:(ow-iw)/2:(oh-ih)/2[v];

    # --- AUDIO: spatial positioning ---
    # Voice: center mono
    [1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[voice];
    # Music: stereo widened
    [2:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,
         stereotools=mode=ms:slevel=1.5[music_wide];

    # --- AUDIO: sidechain ducking ---
    [music_wide][voice]sidechaincompress=threshold=0.02:ratio=6:
                       attack=200:release=1000[ducked];

    # --- AUDIO: transition SFX (panned L/R) ---
    # Whoosh at cut 1 (t=4.2s), panned left
    [3:a]adelay=4100|4100,pan=stereo|c0=1.5*c0|c1=0.3*c0,volume=0.5[sfx0];
    # Whoosh at cut 2 (t=18.1s), panned right
    [4:a]adelay=18000|18000,pan=stereo|c0=0.3*c0|c1=1.5*c0,volume=0.5[sfx1];

    # --- AUDIO: final mix ---
    [voice][ducked][sfx0][sfx1]amix=inputs=4:duration=first[a]
  ' \
  -map '[v]' -map '[a]' \
  -c:v libx264 -preset ultrafast -c:a aac \
  -y output.mp4
```

FFmpeg music-only with beat-synced cuts + SFX + spatial:
```bash
# Cut timestamps pre-snapped to beat map by lib/beats.ts
ffmpeg \
  -i source.mp4 \
  -i music.mp3 \
  -i whoosh-1.mp3 \
  -i whoosh-2.mp3 \
  -i whoosh-3.mp3 \
  -filter_complex '
    # --- VIDEO + TEXT ---
    [0:v]split=3[v0][v1][v2];
    [v0]trim=0:3.28,setpts=PTS-STARTPTS[seg0];
    [v1]trim=8.44:11.72,setpts=PTS-STARTPTS,
        drawtext=text='MagSnap Pro':fontfile=/System/Library/Fonts/Helvetica.ttc:fontsize=72:fontcolor=white:
        x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5:boxborderw=10[seg1];
    [v2]trim=14.53:19.69,setpts=PTS-STARTPTS,
        drawtext=text='$29.99':fontfile=/System/Library/Fonts/Helvetica.ttc:fontsize=64:fontcolor=white:
        x=(w-text_w)/2:y=h-text_h-100:box=1:boxcolor=black@0.5:boxborderw=10[seg2];
    [seg0][seg1][seg2]concat=n=3:v=1:a=0[vc];
    [vc]scale=1080:1920:force_original_aspect_ratio=decrease,
        pad=1080:1920:(ow-iw)/2:(oh-ih)/2[v];

    # --- AUDIO: music widened ---
    [1:a]stereotools=mode=ms:slevel=1.5[music_wide];

    # --- AUDIO: beat-synced SFX (hard L/R pans) ---
    [2:a]adelay=3180|3180,pan=stereo|c0=2*c0|c1=0[sfx0];
    [3:a]adelay=11620|11620,pan=stereo|c0=0|c1=2*c0[sfx1];
    [4:a]adelay=19590|19590,pan=stereo|c0=2*c0|c1=0[sfx2];

    # --- AUDIO: final mix ---
    [music_wide][sfx0][sfx1][sfx2]amix=inputs=4:duration=first[a]
  ' \
  -map '[v]' -map '[a]' \
  -c:v libx264 -preset ultrafast -c:a aac \
  -shortest -y output.mp4
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Shopify-first, not manual forms | "Paste URL → see products" is the demo moment |
| Gemini watches the video | Script matches footage by design — no blind guessing |
| Per-sentence TTS | Gives exact durations for video segment trimming |
| Voice auto-selected by Gemini | Zero manual config — Gemini picks voice to match product vibe |
| Two ad types (narrated / music-only) | Covers both verbal and non-verbal use cases |
| Sidechain ducking on narrated ads | Music breathes around voice — broadcast quality audio mixing |
| Beat-synced cuts on music-only ads | Every transition lands on a beat — feels TikTok-native |
| Lyria-generated music over bundled tracks | Unique per ad, exact duration, no licensing, known BPM = free beat map |
| Transition SFX on every cut | Whoosh sounds make cuts feel professional — trivial to add |
| Source audio analysis before generation | Smarter cuts (align to silence), avoid talking over speech |
| Spatial stereo mix (voice center, music wide, SFX panned) | Noticeable on headphones, strong demo for audio hackathon |
| Shopify video → auto-use, no video → upload prompt | Minimal friction; works either way |
| Server-side FFmpeg over ffmpeg.wasm | Avoids CORS/WASM, more reliable |
| Temp files in /tmp | No cloud storage for hackathon |
| `execFile` over fluent-ffmpeg | Direct FFmpeg control, fewer abstraction issues |

## Environment Variables

```
GEMINI_API_KEY=        # Google AI Studio key (used for both Gemini + Lyria)
ELEVENLABS_API_KEY=    # ElevenLabs key
DATABASE_URL=          # Supabase connection string (Session mode, port 5432)
```

Note: Lyria RealTime uses the same `GEMINI_API_KEY` — it's part of the Gemini API platform.

---

## Analytics

Tracks which products get ads generated and whether a Shopify video was available vs uploaded.

### Schema

```sql
CREATE TABLE IF NOT EXISTS ad_generations (
  id            SERIAL PRIMARY KEY,
  store_url     TEXT        NOT NULL,
  product_handle TEXT       NOT NULL,
  has_video     BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Run this once against your Supabase database (SQL editor in the Supabase dashboard).

### `lib/db.ts`

```typescript
import { Pool } from 'pg';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

Use Supabase's **Session mode** connection string (port `5432`, not `6543`) — the transaction-mode pooler on 6543 doesn't support `SERIAL` or DDL statements.

### `lib/analytics.ts`

```typescript
import { pool } from './db';

export async function trackGeneration(
  storeUrl: string,
  productHandle: string,
  hasVideo: boolean
) {
  try {
    await pool.query(
      'INSERT INTO ad_generations (store_url, product_handle, has_video) VALUES ($1, $2, $3)',
      [storeUrl, productHandle, hasVideo]
    );
  } catch (err) {
    // Never let analytics block a generation
    console.error('Analytics write failed:', err);
  }
}
```

The `try/catch` is intentional — a DB write failure must never cause the generation to fail.

### Where it's called

In `app/api/analyze-video/route.ts`, after parsing the FormData and before calling Gemini:

```typescript
import { trackGeneration } from '@/lib/analytics';

// inside the POST handler:
const storeUrl = formData.get('storeUrl') as string;
const productHandle = formData.get('productHandle') as string;
const hasVideo = formData.get('hasVideo') === 'true';
await trackGeneration(storeUrl, productHandle, hasVideo);
// then proceed with audio analysis + Gemini...
```

Add `storeUrl`, `productHandle`, and `hasVideo` to the `POST /api/analyze-video` FormData inputs (Person 1 passes these — they're available from the product grid navigation).

---

## Audio Editor

After the initial ad is generated, `GenerationView` hands off to `AudioEditor` — an interactive multi-track editor that lets the user refine the ad before downloading.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  [video preview — static, non-editable]                 │
├─────────────────────────────────────────────────────────┤
│  TIMELINE ──────────────────── 0s ─────── 30s ───────  │
│  [Video] │ clip 1 │  clip 2  │ clip 3 │                │
│  [Voice ✕]│"Ever struggle..."│"Meet MagSnap"│           │  ← click to edit
│           │[↺]               │[↺]           │           │  ← re-narrate sentence
│  [Music]  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│   │
│  [SFX]    │  ↯        ↯        ↯                      │  ← toggle each
├─────────────────────────────────────────────────────────┤
│  Voice: [Rachel ▼]  [Re-narrate all]                   │
│  Music: [energetic ▼]  [Regenerate music]              │
├─────────────────────────────────────────────────────────┤
│  AI SUGGEST: ["Make it more punchy..."] [Apply →]      │
├─────────────────────────────────────────────────────────┤
│  [Apply changes + recompose]    [Download current]     │
└─────────────────────────────────────────────────────────┘
```

### Asset storage

All intermediate assets (source video, narration, music) are held **client-side as Blobs** in React state. No server-side session required. On recompose, the client re-POSTs current Blobs to `/api/compose-video` — the same endpoint and FormData shape as the initial generation.

```
initial generation response
  → build EditorState (sentences, voiceId, mood, bpm, sfxEnabled[], adType)
  → store Blobs (sourceVideo, narrationBlob, musicBlob) in React state
  → render <AudioEditor />

user edits
  → update EditorState + dirty flags (narrationDirty, musicDirty)
  → individual regenerate calls update specific Blobs

recompose
  → POST /api/compose-video with current Blobs + EditorState
  → replace preview, clear dirty flags
```

### Track behavior

| Track | Editable | Actions | Backend call |
|-------|----------|---------|--------------|
| Video | No | Click to seek preview | None |
| Voice | Yes | Edit text inline, re-narrate sentence, re-narrate all, remove track | `/api/generate-audio` |
| Music | Yes | Change mood, regenerate | `/api/generate-music` |
| SFX | Yes | Toggle per cut point | None (applied at recompose) |

### Voice track toggle (add/remove narration)

**Remove narration**: sets `narrationBlob = null`, `adType = 'music_only'`. No backend call. Voice track collapses to a "+ Add narration" button.

**Add narration** (from music-only): if sentences already exist in state (user toggled off then on), re-narrate immediately. If no sentences exist (was always music-only), call Gemini via `/api/analyze-video` with `adType=narrated` to generate a script first, then narrate.

### AI Suggest (`POST /api/suggest-edit`)

Free-text instruction input. Thin Gemini wrapper that interprets natural language and returns structured diffs:

```
Request:  { instruction: string, currentScript: string[], currentMood: string }
Response: { updatedScript?: string[], updatedMood?: string }
```

Behavior by instruction type:

| Instruction | Response | Frontend action |
|-------------|----------|-----------------|
| "More casual script" | `updatedScript` | Update sentences, set `narrationDirty` |
| "Calmer vibe" | `updatedMood: "luxury"` | Update mood, set `musicDirty` |
| "Shorter and punchier" | `updatedScript` (fewer sentences) | Update sentences, set `narrationDirty` |

Frontend applies the diff to `EditorState`. User still controls when to recompose — suggest-edit only updates state, never triggers recompose automatically.

### Component structure

```
AudioEditor/
├── AudioEditor.tsx       — container, EditorState, dirty flags, recompose handler
├── Timeline.tsx          — horizontal time axis + track rows
├── TrackControls.tsx     — voice dropdown, music dropdown, re-narrate all
└── AISuggest.tsx         — free-text input, POST /api/suggest-edit, apply diff
```

### New API endpoint

Only one new endpoint is needed. All recompose/regenerate calls reuse existing endpoints:

| Endpoint | Status | Owner |
|----------|--------|-------|
| `POST /api/suggest-edit` | **New** | Person 2 |
| `POST /api/generate-audio` | Existing | Person 2 |
| `POST /api/generate-music` | Existing | Person 2 |
| `POST /api/compose-video` | Existing | Person 3 |

---

## Future Roadmap

### Spatial Audio (Stereo → Full Spatial)

Background music is generated by Lyria in 48kHz stereo. Basic spatial separation (stereotools widening) is in the MVP. Future: full spatial audio processing.

- **Phase 1** (current): Lyria stereo output → stereo-widened → spatial mix with centered voice
- **Phase 2**: Full spatial audio processing pipeline
  - HRTF (Head-Related Transfer Function) processing for binaural output
  - Ambisonics encoding for immersive feel on headphones
  - Voice stays centered and dry; music gets width, depth, subtle room
  - Implementation: FFmpeg `sofalizer` filter with SOFA HRTF files, or Web Audio API `PannerNode` for client-side preview
- **Why it matters**: TikTok/Instagram ads with spatial audio stand out on headphones — music feels alive while voiceover stays clear and centered
- **Applies to both ad types**: Narrated ads get spatial music behind centered voice. Music-only ads get full spatial treatment across the entire mix.

### AI Video Generation

Replace user-supplied footage with AI-generated video:

- **Phase 1** (current): User video from Shopify listing or upload
- **Phase 2**: AI image generation (product shots, lifestyle scenes)
- **Phase 3**: AI video generation via Veo, Runway Gen-3, Stability, Kling
- **How it fits**: Gemini would output scene descriptions instead of timestamp cut lists. Video gen APIs produce clips per scene. Same FFmpeg pipeline for final composition.
- **Benefit**: Truly zero-input ads — merchant provides nothing but a store URL
