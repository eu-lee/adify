# Adify — Implementation Plan

## Context

Building "Adify" for ListenHacks hackathon (~4.5hrs). A Shopify-native video ad generator. Merchant pastes their store URL, picks a product, and gets a full 30-second TikTok-ready ad — auto-scripted to match the footage, professionally narrated (voice auto-picked), background music, intelligently cut. Two modes: narrated or music-only (verbal-less).

Sponsors: **Gemini** (video analysis + script + cut list), **ElevenLabs** (TTS narration).

**The killer demo moment**: Generate an ad, download it, then go back and generate *another one* from a different product. That second generation is what sells it.

---

## Phase 1: Project Scaffolding + Landing Page

**Goal**: Running Next.js app with dark-theme landing page and store URL input.

### Steps

1. Scaffold: `npx create-next-app@latest . --typescript --tailwind --app --src=no --import-alias "@/*"` (skip ESLint)
2. Install: `npm install @google/generative-ai`
3. Create `.env.local` with `GEMINI_API_KEY` and `ELEVENLABS_API_KEY` placeholders
4. **`app/globals.css`** — Tailwind v4 dark theme: background `#0a0a0a`, accent `#3b82f6`, surface/border vars
5. **`app/layout.tsx`** — Inter font, `<html class="dark">`, metadata "Adify"
6. **`app/page.tsx`** — Landing page:
   - Hero: gradient "Adify" title (blue→purple)
   - Subtitle: "Paste your Shopify store. Pick a product. Get a TikTok-ready ad in 30 seconds."
   - Prominent store URL input field + "Connect Store →" button
   - 3-feature strip: "AI Script", "Pro Voiceover", "Auto-Edited Video"
   - Footer: "Built for ListenHacks 2025"
7. Verify: `npm run dev` → landing page at localhost:3000

**Output**: Landing page with store URL input.

---

## Phase 1b: Analytics Database Setup

**Goal**: Supabase Postgres table that records which products get ads generated and whether a Shopify video was available.

### Steps

1. Install: `npm install pg @types/pg`

2. Add to `.env.local`:
   ```
   DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
   ```
   Use the **Session mode** connection string from Supabase (Project Settings → Database → Connection string → Session mode, port `5432`). Do not use the transaction-mode pooler on port 6543 — it doesn't support `SERIAL` columns.

3. **Create the table** — run this once in the Supabase SQL editor:
   ```sql
   CREATE TABLE IF NOT EXISTS ad_generations (
     id             SERIAL PRIMARY KEY,
     store_url      TEXT        NOT NULL,
     product_handle TEXT        NOT NULL,
     has_video      BOOLEAN     NOT NULL DEFAULT false,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```

4. **`lib/db.ts`**:
   ```typescript
   import { Pool } from 'pg';
   export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   ```

5. **`lib/analytics.ts`**:
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
       console.error('Analytics write failed:', err);
       // Never block a generation for a DB write failure
     }
   }
   ```

6. **Call it** in `app/api/analyze-video/route.ts` — parse `storeUrl`, `productHandle`, `hasVideo` from the FormData and call `trackGeneration()` before the Gemini call. Add these three fields to the analyze-video FormData request (they're known at the product page and should be passed through).

**Output**: Every ad generation writes one row to Supabase. Verify in the Supabase Table Editor.

---

## Phase 2: Shopify Store Connection + Product Grid

**Goal**: Fetch products from any Shopify store, display as grid, flag which have video.

### Steps

1. **`lib/shopify.ts`** — `fetchProducts(storeUrl: string)`:
   - Normalize URL (strip protocol, trailing slashes)
   - GET `https://{storeUrl}/products.json?limit=50`
   - Parse each product: `{ id, handle, title, description, images[], price, variants }`
   - Check for video media: attempt to find video URLs in the product data. **Note**: `/products.json` often omits the `media` array with video entries — it's only reliable via `/products/{handle}.json` or the Storefront API. Set `hasVideo = false` by default; only set `true` if a video URL is confirmed.
   - Return: `{ id, handle, title, description, image, price, hasVideo, videoUrl }`
   - **The upload prompt must work reliably for every product** — don't design the flow assuming `hasVideo` will be `true`.

2. **`app/api/store/products/route.ts`** — GET handler:
   - Query param: `?url={storeUrl}`
   - Call `fetchProducts()`, return JSON
   - try/catch → appropriate errors

3. **`app/store/page.tsx`** — Product grid page:
   - Reads `?url=` from search params
   - Fetches products on load
   - Renders `<ProductGrid />`
   - Store name in header, "Adify" logo linking home
   - Loading skeleton while fetching

4. **`components/ProductGrid.tsx`** — Grid layout
   - Responsive: 2 cols mobile, 3 tablet, 4 desktop
   - Each card: product image, title, price
   - Small badge on products that have video ("Video available")
   - Click → navigate to `/generate/{handle}?store={storeUrl}`

5. **`components/ProductCard.tsx`** — Single card
   - Image with hover scale
   - Title (2-line truncate), price
   - "Generate Ad →" hover overlay

6. Wire landing page: URL input → navigates to `/store?url={value}`

**Output**: Paste any Shopify URL → product grid with video availability indicators.

---

## Phase 3: Video Source + Ad Type Selection

**Goal**: Resolve video source (Shopify or upload) and let user pick narrated vs music-only.

### Steps

1. **`app/generate/[handle]/page.tsx`** — Generation page:
   - Fetch product details from store API
   - Check `hasVideo`:
     - **Yes** → auto-use Shopify product video (download/stream from CDN)
     - **No** → show `<VideoUpload />` component
   - Once video is ready, show `<AdTypeSelector />`
   - After selection, kick off generation pipeline

2. **`components/VideoUpload.tsx`** — Upload prompt:
   - "This product doesn't have a video on Shopify. Upload a short clip of your product."
   - Drag-and-drop zone + file input (`accept="video/*"`)
   - Single file, max 60 seconds, max 100MB
   - Show filename + size after upload
   - "Use This Video →" button

3. **`components/AdTypeSelector.tsx`** — Two sections:

   **Ad type** — two big cards side by side:
   - **Narrated Ad** — "AI-written script with professional voiceover. Best for storytelling and product demos."
   - **Music-Only Ad** — "Cinematic cuts with background music and text overlays. Best for visual products."
   - Selected card gets highlight

   **Duration** — three pill buttons in a row:
   - **15s** — "Stories / Reels"
   - **30s** (default, pre-selected) — "TikTok"
   - **60s** — "YouTube"
   - Selected pill gets highlight

   - "Generate →" button triggers the pipeline with both selections

4. Wire it all: product page resolves video → shows ad type + duration picker → triggers pipeline

**Output**: Video resolved + ad type + duration selected → ready for generation.

---

## Phase 4: Gemini Video Analysis + Script Generation

**Goal**: Gemini watches the source video, writes the ad script + cut list, and picks the voice.

### Steps

1. **`lib/gemini.ts`** — Core intelligence:

   a. `analyzeVideoForNarratedAd(videoBuffer, product, audioAnalysis, duration)`:
   - Upload video to Gemini via `fileManager.uploadFile()` or inline as base64
   - Include audio analysis hints in prompt: silence regions as preferred cut points, speech detection results
   - Prompt: "Watch this video. Write a {duration}s narrated ad script. For each sentence, specify which timestamp range from the source video best matches. Also pick the ideal ElevenLabs voice. Prefer cutting at these silent moments: [silence regions from audio analysis]."
   - Duration calibrates output: 15s → 2-3 sentences, 30s → 4-6 sentences, 60s → 8-12 sentences
   - Return: `{ mood, voice: { id, gender, tone }, sentences: [{ text, videoStart, videoEnd }] }`

   b. `analyzeVideoForMusicAd(videoBuffer, product, audioAnalysis, duration)`:
   - Upload same video
   - Include audio analysis hints: silence regions, volume profile
   - Prompt: "Watch this video. Create a {duration}s music-only ad. Determine best cuts for visual rhythm. Prefer cutting at these silent moments: [silence regions]. Add text overlays for product name, price, and CTA where appropriate."
   - Duration calibrates output: 15s → 4-6 cuts, 30s → 6-10 cuts, 60s → 12-18 cuts
   - Return: `{ mood, cuts: [{ videoStart, videoEnd, textOverlay? }] }`

   c. Voice ID mapping — provide Gemini with a known set of ElevenLabs voices and descriptions so it can pick intelligently:
   - Rachel (JBFqnCBsd6RMkjVDRZzb) — warm professional female
   - Adam (pNInz6obpgDQGcFmaJgB) — deep authoritative male
   - Bella (EXAVITQu4vr4xnSDxMaL) — young friendly female
   - Antoni (ErXwobaYiN019PkySvjV) — warm calm male
   - Elli (MF3mGyEYCl7XYWbV9V6O) — energetic young female
   - Josh (TxGEqnHWrfWFTfGW9XjX) — deep narrative male

2. **`app/api/analyze-video/route.ts`** — POST handler:
   - Input: FormData with `video` (file), `product` (JSON string), `adType` (string), `duration` (number)
   - `export const runtime = 'nodejs'`
   - Write video to `/tmp/adify-{timestamp}/source.mp4`
   - **Run `analyzeSourceAudio(videoPath)` internally** — no separate audio analysis API route needed; this route already has the file
   - Call appropriate Gemini function, passing duration + audio analysis hints
   - Return JSON analysis **plus `audioAnalysis` and `bpm`** in the response so the frontend can forward them to compose-video

3. Wire into generation page: after video + ad type resolved, POST to `/api/analyze-video`

**Output**: Gemini has watched the video and produced script + cut list + voice selection.

---

## Phase 5: ElevenLabs Narration + FFmpeg Composition

**Goal**: Analyze source audio, generate narration (if narrated), select music, compose final video with full audio engineering pipeline.

### Steps

1. **`lib/audio-analysis.ts`** — `analyzeSourceAudio(videoPath)`:
   - Run FFmpeg `silencedetect` on source video → array of `{ start, end }` silent regions
   - Run FFmpeg `volumedetect` → peak and mean volume levels
   - Detect speech: if mean volume > -30dB and few silence regions → likely has speech
   - Return `{ silenceRegions, meanVolume, peakVolume, hasSpeech }`
   - Fed to Gemini as hints: "use these silence regions as preferred cut points"
   - If speech detected + narrated ad: strip source audio (avoid two voices)
   - If no speech + interesting ambient: keep as low bed at ~10% volume

2. **`lib/elevenlabs.ts`** — `generateSpeech(sentences, voiceId)`:
   - Send all sentences in parallel to ElevenLabs (`Promise.all`) for speed
   - POST `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}`
   - Headers: `xi-api-key`, `Content-Type: application/json`
   - Body: `{ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }`
   - ElevenLabs returns raw MP3 bytes — no duration metadata in the response
   - **Measure duration with ffprobe**: write each chunk to `/tmp`, run `ffprobe -v error -show_entries format=duration -of csv=p=0 chunk.mp3`, parse as ms
   - Do NOT estimate from byte size — bitrate and silence variation make this unreliable and will cause A/V desync
   - Collect: `{ audio: ArrayBuffer, durationMs: number }[]`
   - Per-sentence TTS gives us exact durations for trimming video segments

3. **`lib/lyria.ts`** — `generateMusic(mood, durationSeconds)`:
   - Map mood to Lyria weighted prompt + config (BPM, density, brightness):
     - energetic → "upbeat electronic pop, driving beat", BPM 128, high density
     - luxury → "elegant piano, ambient, sophisticated", BPM 72, low density
     - playful → "fun ukulele, upbeat acoustic", BPM 110, medium density
     - professional → "clean corporate, ambient technology", BPM 90
     - emotional → "emotional piano strings, cinematic", BPM 68, low density
     - minimalist → "minimal ambient, soft electronic", BPM 80, low density
   - Connect to Lyria RealTime via `@google/genai` SDK WebSocket
   - Set weighted prompts + `MusicGenerationConfig` (bpm, density, brightness)
   - Stream for target duration, collect raw 16-bit PCM chunks (48kHz stereo)
   - Convert PCM → WAV/MP3 for FFmpeg
   - Return `{ musicPath, bpm }` — BPM is known, beat map is free math
   - Uses same `GEMINI_API_KEY` (Lyria is part of Gemini API)
   - Fallback: bundle 2-3 royalty-free tracks if Lyria unavailable

4. **`lib/beats.ts`** — `snapCutsToBeatMap(cuts, bpm, duration)`:
   - Compute beat map from Lyria's known BPM: `beats = [0, 60/bpm, 120/bpm, ...]`
   - No audio analysis needed — BPM is exact
   - Snap each cut boundary to nearest beat
   - Adjust segment durations to maintain total target duration
   - High-energy moods: cuts every 1-2 beats. Slower moods: every 4-8 beats
   - Return beat-aligned cut list for FFmpeg

5. **`lib/ffmpeg.ts`** — Two composition functions, both with full audio engineering:

   a. `composeNarratedAd(videoPath, audioChunks, musicPath, sfxPaths, sentences, audioAnalysis, outputPath)`:
   - Trim + concat video segments matched to sentence durations
   - Scale to 1080x1920 (9:16)
   - **Spatial mix**: voice center mono, music stereo-widened (`stereotools mode=ms:slevel=1.5`)
   - **Sidechain ducking**: `sidechaincompress` — music ducks under voice, swells in gaps
   - **Transition SFX**: whoosh at each cut point, alternating L/R pan, 50% volume (under voice)
   - **Source ambient**: if `!hasSpeech`, mix source audio at ~10% as ambient bed
   - `execFile('ffmpeg', [...])`

   b. `composeMusicAd(videoPath, musicPath, sfxPaths, beatSnappedCuts, audioAnalysis, outputPath)`:
   - Trim at **beat-snapped** cut points
   - Scale to 1080x1920
   - Burn text overlays via `drawtext`
   - **Spatial mix**: music full stereo-widened, more aggressive width since no voice to protect
   - **Transition SFX**: whoosh at each beat-synced cut, hard L/R pans, full volume
   - **Source ambient**: optionally mix source audio as low bed for authenticity
   - `execFile('ffmpeg', [...])`

6. **`app/api/generate-audio/route.ts`** — POST handler:
   - Input: `{ sentences: string[], voiceId: string }`
   - Call `generateSpeech()` — all sentences in parallel
   - Return: `{ chunks: [{ durationMs }], fullAudioBase64 }`

6b. **`app/api/generate-music/route.ts`** — POST handler *(required — Lyria runs server-side via WebSocket)*:
   - `export const runtime = 'nodejs'`, `export const maxDuration = 120`
   - Input: JSON `{ mood: string, durationSeconds: number }`
   - Call `generateMusic(mood, durationSeconds)` from `lib/lyria.ts`
   - Read the output WAV from `/tmp`, return as `Response` with `Content-Type: audio/wav`
   - **Run in parallel with `/api/generate-audio`** — fire both immediately after analyze-video returns mood

7. **`app/api/compose-video/route.ts`** — POST handler:
   - `export const runtime = 'nodejs'`, `maxDuration = 120`
   - Input: FormData with source video, narration audio (if narrated), music, SFX paths, cut list JSON, audio analysis JSON
   - Write everything to /tmp
   - Call appropriate compose function
   - Return `video/mp4` blob

8. **`components/GenerationView.tsx`** — Loading + preview:
   - Progressive status messages:
     - "Analyzing your video..." (audio analysis + Gemini)
     - "Writing the perfect script..." (Gemini, narrated only)
     - "Recording voiceover..." (ElevenLabs, narrated only)
     - "Composing your soundtrack..." (Lyria music generation)
     - "Syncing cuts to the beat..." (music-only: beat-snap)
     - "Engineering the audio mix..." (ducking + SFX + spatial)
     - "Composing your ad..." (FFmpeg)
   - When complete: `<video controls autoplay>` with the final ad
   - "Download" button → saves MP4
   - "Make Another Ad" → back to product grid

9. Wire the full pipeline in `app/generate/[handle]/page.tsx`:
   - Video + ad type resolved (Phase 3)
   - → **POST `/api/analyze-video`** — sends video + product + adType + duration. The route runs audio analysis internally before calling Gemini. Response: script/cuts + mood + voice + bpm + audioAnalysis.
   - → **In parallel**: POST `/api/generate-music` (mood + duration → WAV blob) AND, if narrated, POST `/api/generate-audio` (sentences + voiceId → narration + chunk durations)
   - → **If music-only**: snap Gemini's cut list to beat map using `bpm` from analyze-video response
   - → **POST `/api/compose-video`** — video + narration + music WAV + cutList + chunkDurations + audioAnalysis + adType + bpm. `audioAnalysis` is forwarded from the analyze-video response, not re-computed.
   - → Preview + download

**Output**: Full end-to-end — pick product → 30s composed ad plays.

---

## Phase 6: Polish the Loop

**Goal**: Make "generate another one" buttery smooth. This is what sells the demo.

### Steps

1. **Back-to-grid navigation**: "Make Another Ad" → product grid with store still loaded (cache in URL params)

2. **Loading experience**:
   - Animated progress steps with checkmarks as each completes
   - Show script text appearing during generation (narrated mode)
   - Smooth transitions between states

3. **Video player polish**:
   - Auto-play when ready
   - Full-screen toggle
   - Download button always visible

4. **Product grid polish**:
   - "Ad Generated" badge on products that already had an ad made
   - Quick filters

5. **Error resilience**:
   - If ElevenLabs fails → show script text, offer retry
   - If FFmpeg fails → offer audio-only download
   - If Shopify video download fails → fall back to upload prompt
   - Retry buttons on each step

**Output**: Smooth, demo-ready loop.

---

## Phase 7: Stretch Goals (time permitting)

Priority order:

1. **Streaming Gemini analysis** — `generateContentStream()` for progressive script reveal during loading
2. **Voice preview** — Before generating, quick 5-second sample of the auto-selected voice
3. **Ad style override** — Optional: let user override Gemini's mood pick
4. **Multiple formats** — 9:16 (TikTok), 1:1 (Instagram), 16:9 (YouTube) variants
5. **Spatial audio** — Process background music through HRTF/binaural pipeline before mixing (see architecture.md)
6. **AI video generation** — Replace user footage with AI-generated clips (see architecture.md)

---

## Verification Checklist

- [ ] Landing page renders with store URL input
- [ ] Paste a Shopify store URL → product grid loads with video badges
- [ ] Click a product WITH video → auto-uses it, shows ad type selector
- [ ] Click a product WITHOUT video → upload prompt appears
- [ ] Select "Narrated Ad" → Gemini analyzes → script + voice auto-picked
- [ ] ElevenLabs narrates → sidechain ducking mixes voice + music → ad plays
- [ ] Music audibly ducks under voice and swells in gaps between sentences
- [ ] Whoosh SFX audible at each visual cut (alternating L/R on headphones)
- [ ] On headphones: voice is center, music is wide, SFX pan left/right
- [ ] Select "Music-Only Ad" → Gemini outputs cuts → cuts snap to beat map → ad plays
- [ ] Visual transitions in music-only ad land on musical beats
- [ ] Music-only ad has whooshes at full volume, hard-panned on each beat-synced cut
- [ ] Download saves a valid MP4
- [ ] "Make Another Ad" → back to grid → different product → generates again
- [ ] Second generation works as smoothly as the first

---

## Risk Mitigation

| Risk | Fallback |
|------|----------|
| Shopify `/products.json` blocked | Scrape HTML, or use a demo store we control |
| Shopify video not in `/products.json` | Fall back to upload prompt always |
| Gemini video upload too slow/large | Compress video first, or extract keyframes + send as images |
| Gemini bad timestamp accuracy | Add ±0.5s buffer to each cut, or fall back to even splits |
| ElevenLabs rate limits | Pre-generate demo narration, cache results |
| FFmpeg issues | Demo with script + audio only (still strong for audio hackathon) |
| Video encoding slow | `-preset ultrafast`, keep total ≤30s, small resolution for draft |

---

## Demo Script

> "I'm a Shopify merchant. I connect my store..."
> [Paste URL → product grid loads]
> "I see all my products. I pick this one..."
> [Click product → video found → pick "Narrated Ad" → loading screen → ad plays]
> "30 seconds. Full ad. Script written to match my footage, professional voiceover auto-picked for my brand. Put on headphones — hear how the voice sits in the center while the music wraps around you. Music ducks under the voice and swells in the gaps. Whooshes on every cut. Ready for TikTok."
> [Hit download]
> "Let me make another one."
> [Go back, pick different product, generate again]
>
> That second generation is what sells it. Shows it's not a one-trick demo — it's a tool.
