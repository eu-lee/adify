# Adify — Team Instructions

3 people, 4 hours. Read `architecture.md` and `plan.md` first — this doc tells you **who does what**.

---

## Roles

| Person | Role | Focus |
|--------|------|-------|
| **Person 1** | Frontend + Shopify | UI, pages, components, Shopify integration |
| **Person 2** | AI Pipeline | Gemini video analysis, ElevenLabs TTS, Lyria music gen |
| **Person 3** | Audio Engineering + FFmpeg | Audio analysis, beat sync, ducking, SFX, spatial mix, video composition |

---

## Person 1: Frontend + Shopify

You own everything the user sees and the Shopify data layer. You are unblocked from minute one — no API dependencies for your first 2 hours.

### Hour 1 (0:00–1:00): Scaffolding + Landing + Product Grid

1. **Scaffold the app**
   ```bash
   npx create-next-app@latest . --typescript --tailwind --app --src=no --import-alias "@/*" --yes
   npm install @google/generative-ai @google/genai pg @types/pg
   ```

1b. **Set up analytics DB** — `lib/db.ts` + `lib/analytics.ts`:
   - Add `DATABASE_URL` to `.env.local` — use the Supabase Session mode connection string (port `5432`)
   - Run the schema SQL once in the Supabase SQL editor:
     ```sql
     CREATE TABLE IF NOT EXISTS ad_generations (
       id             SERIAL PRIMARY KEY,
       store_url      TEXT        NOT NULL,
       product_handle TEXT        NOT NULL,
       has_video      BOOLEAN     NOT NULL DEFAULT false,
       created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
     );
     ```
   - `lib/db.ts`: `export const pool = new Pool({ connectionString: process.env.DATABASE_URL });`
   - `lib/analytics.ts`: `trackGeneration(storeUrl, productHandle, hasVideo)` — INSERT with try/catch (never block generation on DB failure)
   - This is ~15 minutes, do it first while the scaffold is running.

2. **Set up dark theme** — `app/globals.css`
   - Tailwind v4, background `#0a0a0a`, accent `#3b82f6`, surface/border vars

3. **Root layout** — `app/layout.tsx`
   - Inter font, `<html class="dark">`, metadata "Adify"

4. **Landing page** — `app/page.tsx`
   - Gradient "Adify" title (blue→purple)
   - Subtitle: "Paste your Shopify store. Pick a product. Get a TikTok-ready ad in 30 seconds."
   - Store URL input field + "Connect Store →" button
   - 3-feature strip: "AI Script", "Pro Voiceover", "Auto-Edited Video"
   - On submit: navigate to `/store?url={inputValue}`

5. **Shopify fetcher** — `lib/shopify.ts`
   - `fetchProducts(storeUrl)` — GET `https://{storeUrl}/products.json?limit=50`
   - Normalize URL (strip protocol, trailing slashes)
   - Return `{ id, handle, title, description, image, price, hasVideo, videoUrl }`
   - **Caveat**: `/products.json` often does NOT include video media entries — the `media` array with video is only reliable via `/products/{handle}.json` or the Storefront API. Set `hasVideo = false` by default and only set it `true` if you can confirm a video URL. **The upload path must work for every product** — don't assume auto-detection will fire often.

6. **API route** — `app/api/store/products/route.ts`
   - GET handler, query param `?url=`, calls `fetchProducts()`

7. **Product grid page** — `app/store/page.tsx`
   - Read `?url=` from search params
   - Fetch products on load, loading skeleton
   - "Adify" header linking home

8. **Components**: `ProductGrid.tsx`, `ProductCard.tsx`
   - Responsive grid: 2/3/4 cols
   - Card: image, title, price, "Video available" badge
   - Hover: scale effect + "Generate Ad →" overlay
   - Click → `/generate/{handle}?store={storeUrl}`

**Test**: Paste a real Shopify store URL, see product grid load.

### Hour 2 (1:00–2:00): Generate Page + Ad Config UI

9. **Generate page** — `app/generate/[handle]/page.tsx`
   - Fetch product details from store API (using handle + store URL from query)
   - Check `hasVideo`:
     - Yes → auto-use Shopify video URL
     - No → show `<VideoUpload />`
   - Once video ready → show `<AdTypeSelector />`
   - After selection → trigger generation (calls Person 2's API routes)

10. **VideoUpload component** — `components/VideoUpload.tsx`
    - "Upload a short video of your product"
    - Drag-and-drop zone + file input (`accept="video/*"`)
    - Single file, show filename + size
    - "Use This Video →" button

11. **AdTypeSelector component** — `components/AdTypeSelector.tsx`
    - Two big cards: **Narrated Ad** / **Music-Only Ad** (descriptions from plan.md)
    - Three duration pills: **15s** / **30s** (default) / **60s**
    - "Generate →" button

12. **GenerationView component** — `components/GenerationView.tsx`
    - Takes generation state as props (which step is active, progress)
    - Progressive status messages with animated spinner:
      - "Analyzing your video..."
      - "Writing the perfect script..."
      - "Recording voiceover..."
      - "Composing your soundtrack..."
      - "Syncing cuts to the beat..."
      - "Engineering the audio mix..."
      - "Composing your ad..."
    - Checkmarks on completed steps
    - When done: `<video controls autoplay>` with object URL
    - "Download" button, "Make Another Ad" button (→ back to grid)

**Test**: Navigate through the full UI flow (without real generation — mock it).

### Audio Editor (after generation pipeline is wired)

Once the generation pipeline produces a real ad, replace the `<GenerationView>` preview with `<AudioEditor>`. All components live in `components/AudioEditor/`.

**Build in this order:**

1. **`AudioEditor.tsx`** — container:
   - Accepts `initialState: EditorState` + `initialAssets: EditorAssets` as props
   - `EditorState` is built from generation pipeline output (sentences, voiceId, mood, bpm, sfxEnabled[], adType)
   - `EditorAssets` = `{ sourceVideo: File|Blob, narrationBlob: Blob|null, musicBlob: Blob }`
   - Manages dirty flags (`narrationDirty`, `musicDirty`)
   - Recompose handler: POST `/api/compose-video` with current assets + state → replace preview blob

2. **`Timeline.tsx`** — four-track horizontal timeline:
   - Time axis scaled to ad duration
   - **Video track** (read-only): clip blocks with `videoStart`–`videoEnd`; click → seek preview
   - **Voice track**: sentence blocks, width from `chunkDurations`; click block → inline text edit; per-block "↺" re-narrate button; "✕ Remove" header button → strips narration, sets `adType = 'music_only'`; in music-only mode shows "+ Add narration" button
   - **Music track**: full-width bar colored by mood; mood dropdown in header; "Regenerate" → POST `/api/generate-music` → update `musicBlob`
   - **SFX track**: markers at each cut point; click to toggle `sfxEnabled[i]`

3. **`TrackControls.tsx`** — panel below timeline:
   - Voice dropdown (Rachel, Adam, Bella, Antoni, Elli, Josh) + "Re-narrate all" → POST `/api/generate-audio` with all sentences + new voiceId
   - Music mood dropdown + "Regenerate music" (mirrors track header)

4. **`AISuggest.tsx`** — free-text AI assist:
   - Text input + "Apply suggestion" button
   - POST `/api/suggest-edit` → apply `updatedScript`/`updatedMood` to state, set dirty flags
   - User still manually triggers recompose

5. **Wire into generate page**: after compose-video returns, build `EditorState` from pipeline data and render `<AudioEditor />` instead of simple preview

**Add narration flow** (music-only → add voice):
- If sentences exist in state (toggled off then back on): just re-narrate
- If no sentences (was always music-only): POST `/api/analyze-video` with `adType=narrated` → get script → POST `/api/generate-audio` → set narrationBlob

### Hour 3–4 (2:00–4:00): Integration + Polish

13. **Wire up the generation pipeline** in the generate page in this order:
    1. POST `/api/analyze-video` — send video + product + adType + duration. Response includes `sentences`/`cuts`, `mood`, `voice`, `bpm`, and `audioAnalysis`. **Do not pass `audioAnalysis` as input — the route generates it internally.**
    2. In parallel: POST `/api/generate-audio` (narrated only) AND POST `/api/generate-music` — both need `mood` from step 1. `/api/generate-music` returns a WAV blob.
    3. For music-only: snap cuts to beat map client-side (or server-side in compose-video) using `bpm` from step 1.
    4. POST `/api/compose-video` — send video + narration (narrated only) + music WAV + cutList + chunkDurations + audioAnalysis + adType + bpm.
    - Update GenerationView state at each step
    - Create object URLs for preview

14. **"Make Another Ad" loop**:
    - Back button → product grid (store URL preserved in URL params)
    - "Ad Generated" badge on products that already have an ad (client-side state)

15. **Error states**: Retry buttons, fallback messages

16. **Polish**: Loading animations, transitions, responsive layout, test on mobile

**Coordinate with Person 2**: You need their API route contracts by hour 2. Agree on request/response shapes early. You can mock their endpoints until they're ready.

---

## Person 2: AI Pipeline

You own Gemini (video analysis + script + voice selection), ElevenLabs (TTS narration), and Lyria (music generation). Your output is API routes that Person 1 calls and audio/data that Person 3 consumes.

### Hour 1 (0:00–1:00): Gemini Video Analysis

1. **Set up `.env.local`**:
   ```
   GEMINI_API_KEY=your_key_here
   ELEVENLABS_API_KEY=your_key_here
   ```

2. **`lib/gemini.ts`** — Core intelligence. Two functions:

   a. `analyzeVideoForNarratedAd(videoBuffer, product, audioAnalysis, duration)`:
   - Upload video to Gemini via `fileManager.uploadFile()` or inline
   - Model: `gemini-2.0-flash`
   - Prompt (from architecture.md): write a {duration}s narrated ad, return JSON with mood, voice (ElevenLabs ID), sentences (text + videoStart + videoEnd)
   - Include audio analysis hints (silence regions) if available
   - Include voice ID mapping in prompt so Gemini picks from known set:
     - Rachel `JBFqnCBsd6RMkjVDRZzb`, Adam `pNInz6obpgDQGcFmaJgB`, Bella `EXAVITQu4vr4xnSDxMaL`, Antoni `ErXwobaYiN019PkySvjV`, Elli `MF3mGyEYCl7XYWbV9V6O`, Josh `TxGEqnHWrfWFTfGW9XjX`
   - Parse JSON from response, return structured data

   b. `analyzeVideoForMusicAd(videoBuffer, product, audioAnalysis, duration)`:
   - Same video upload
   - Prompt: create {duration}s music-only ad, return JSON with mood, cuts (videoStart, videoEnd, textOverlay?)
   - Parse and return

3. **`app/api/analyze-video/route.ts`** — POST handler:
   - `export const runtime = 'nodejs'`
   - Parse FormData: video file, product JSON, adType, duration, storeUrl, productHandle, hasVideo
   - **Call `trackGeneration(storeUrl, productHandle, hasVideo === 'true')`** from `lib/analytics.ts` — do this first, it's fire-and-forget
   - **Write video to `/tmp/adify-{timestamp}/source.mp4` first**
   - **Run `analyzeSourceAudio(videoPath)` internally** — get silence regions + speech detection
   - Call appropriate Gemini function, passing audio analysis hints
   - Return JSON result **including `audioAnalysis`** so Person 1 can forward it to compose-video
   - No separate audio analysis API route is needed — this route has the file and runs it here

**Test**: Upload a test video, get back script + cut list. Verify timestamps make sense.

### Hour 2 (1:00–2:00): ElevenLabs + Lyria

4. **`lib/elevenlabs.ts`** — `generateSpeech(sentences: string[], voiceId: string)`:
   - For each sentence, POST to `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}`
   - Headers: `xi-api-key`, `Content-Type: application/json`
   - Body: `{ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }`
   - **Send all sentences in parallel** (`Promise.all`) for speed
   - For each chunk, write to `/tmp/adify-{timestamp}/chunk-{i}.mp3`, then run:
     ```
     ffprobe -v error -show_entries format=duration -of csv=p=0 chunk-{i}.mp3
     ```
     Parse the output as `durationMs = parseFloat(output) * 1000`. **Do not estimate from byte size** — byte size is unreliable and even 200ms error causes A/V desync.
   - Concat all chunks into one narration track
   - Return per-sentence durations (Person 3 needs these) + full audio buffer

5. **`app/api/generate-audio/route.ts`** — POST handler:
   - Input: `{ sentences: string[], voiceId: string }`
   - Call `generateSpeech()`
   - Return: JSON with `{ chunks: [{ durationMs }], fullAudioBase64 }`

5b. **`app/api/generate-music/route.ts`** — POST handler *(new — required for Person 1 to trigger Lyria)*:
   - `export const runtime = 'nodejs'`
   - `export const maxDuration = 120`
   - Input: JSON `{ mood: string, durationSeconds: number }`
   - Call `generateMusic(mood, durationSeconds)`
   - Read the WAV file from `/tmp`, return as `Response` with `Content-Type: audio/wav`
   - This runs in parallel with `/api/generate-audio` — fire both after `/api/analyze-video` returns mood

6. **`lib/lyria.ts`** — `generateMusic(mood: string, durationSeconds: number)`:
   - Map mood to Lyria config (see architecture.md for the full mapping):
     - energetic → BPM 128, density 0.8, brightness 0.7, "upbeat electronic pop"
     - luxury → BPM 72, density 0.3, brightness 0.4, "elegant piano, ambient"
     - etc.
   - Connect via `@google/genai` SDK: `client.live.music.connect({ model: 'lyria-realtime-exp' })`
   - Set weighted prompts + MusicGenerationConfig (bpm, density, brightness, temperature)
   - Call `session.play()`, collect PCM chunks until target duration reached, then `session.stop()`
   - Raw output: 16-bit PCM, 48kHz, stereo
   - Convert to WAV: write a WAV header (44 bytes) + raw PCM data
   - Write to `/tmp/adify-music-{timestamp}.wav`
   - Return `{ musicPath, bpm }`
   - **Fallback**: if Lyria fails, use a bundled track from `/public/music/`

**Test**: Generate narration for a test script. Generate a 30s music track with mood "energetic". Both should produce valid audio files.

### `POST /api/suggest-edit` (new — own this alongside integration work)

Thin Gemini endpoint for the audio editor's AI suggest feature.

```typescript
// Request
{ instruction: string, currentScript: string[], currentMood: string }

// Response
{ updatedScript?: string[], updatedMood?: string }
```

- Use `gemini-2.0-flash` with a structured JSON prompt
- Only return fields that changed (both are optional)
- Prompt should instruct Gemini to: interpret the instruction, rewrite the script if style/length/tone changes are implied, return a new mood string if vibe/energy changes are implied
- Valid mood values: `"energetic" | "luxury" | "playful" | "professional" | "emotional" | "minimalist"`
- Keep it stateless — no video upload needed, just text in/text out

### Hour 3 (2:00–3:00): Integration + Optimization

7. **Wire everything together** — make sure the full flow works:
   - Gemini returns mood → Lyria uses mood for music
   - Gemini returns voice ID → ElevenLabs uses it
   - Gemini returns sentences → ElevenLabs narrates them
   - Per-sentence durations from ElevenLabs → Person 3 uses for video trimming

8. **Parallelization**: After Gemini returns:
   - Fire ElevenLabs (all sentences) AND Lyria (music) simultaneously
   - Both can run in parallel since they're independent
   - This saves 3-5 seconds from total pipeline time

9. **Video compression before Gemini upload**:
   - Before sending to Gemini, compress the video: `ffmpeg -i input.mp4 -vf scale=640:-1 -preset ultrafast compressed.mp4`
   - Reduces upload size from ~50-80MB to ~5-10MB
   - Gemini doesn't need full resolution to understand the content
   - Add this as a utility in `lib/gemini.ts`

10. **Error handling**: Wrap all API calls in try/catch, return meaningful error messages to frontend

**Coordinate with Person 3**: They need from you:
- `sentences[].text` + `sentences[].videoStart` + `sentences[].videoEnd` (from Gemini)
- `chunks[].durationMs` (from ElevenLabs — actual audio duration per sentence, measured via ffprobe)
- music WAV blob (from Lyria, returned by `/api/generate-music`)
- `bpm` (from Lyria — returned in analyze-video response alongside mood)
- `mood` (from Gemini — for SFX volume/panning decisions)
- `audioAnalysis` (from your analyze-video route — you generate it, you return it, Person 1 forwards it)

### Hour 4 (3:00–4:00): Edge Cases + Demo Prep

11. Ensure it works with:
    - Very short videos (< 15s source)
    - Videos with no audio track
    - Products with minimal descriptions
    - Different Shopify stores

12. **Pre-generate demo assets** for 2-3 products in case of API rate limits during live demo

13. Help Person 1 with integration bugs

---

## Person 3: Audio Engineering + FFmpeg

You own the audio intelligence layer and the final video composition. Everything that makes this sound professional — ducking, beat sync, SFX, spatial mix — is yours. You also own the FFmpeg pipeline that produces the final MP4.

### Hour 1 (0:00–1:00): Audio Analysis + Beats + SFX Assets

1. **Ensure FFmpeg is installed and verify required filters**:
   ```bash
   brew install ffmpeg  # or verify it's available
   ffmpeg -filters 2>/dev/null | grep -E "sidechaincompress|stereotools"
   ```
   Both must appear. If `sidechaincompress` is missing, your FFmpeg wasn't compiled with `--enable-libavfilter` or is too old — reinstall from `brew install ffmpeg` (Homebrew includes these). If `stereotools` is missing, same fix. **Verify this in Hour 1** — the entire audio engineering pipeline depends on these filters.

2. **Source SFX assets** — Find and download:
   - 3 short whoosh sounds (~0.2-0.3s each), save as `/public/sfx/whoosh-1.mp3`, `whoosh-2.mp3`, `whoosh-3.mp3`
   - 1 riser sound (~1s), save as `/public/sfx/riser.mp3`
   - Sources: freesound.org, pixabay.com/sound-effects (royalty-free)
   - Keep them SHORT — long SFX will overlap with narration

3. **Bundle fallback music** — Find 2-3 royalty-free tracks:
   - Save to `/public/music/` as fallback if Lyria is unavailable
   - One upbeat, one calm, one cinematic

4. **`lib/audio-analysis.ts`** — `analyzeSourceAudio(videoPath: string)`:
   ```typescript
   import { execFile } from 'child_process';
   import { promisify } from 'util';
   const execFileAsync = promisify(execFile);
   ```
   - Run `ffmpeg -i {videoPath} -af silencedetect=noise=-30dB:d=0.5 -f null -` → parse stderr for silence regions
   - Run `ffmpeg -i {videoPath} -af volumedetect -f null -` → parse stderr for mean/peak volume
   - Speech detection: if mean volume > -30dB and few silence gaps → `hasSpeech = true`
   - Return `{ silenceRegions: [{start, end}], meanVolume, peakVolume, hasSpeech }`

5. **`lib/beats.ts`** — `snapCutsToBeatMap(cuts, bpm, targetDuration)`:
   - Generate beat map from BPM: `beats = [0, 60/bpm, 120/bpm, ...]`
   - For each cut boundary, find nearest beat
   - Snap to closest beat that keeps segment ≥ 0.5s (avoid micro-cuts)
   - Return adjusted cut list

**Test**: Run audio analysis on a sample video. Verify silence detection works. Test beat-snap math with known BPM values.

### Hour 2 (1:00–2:00): FFmpeg Composition — Narrated Ads

6. **`lib/ffmpeg.ts`** — Start with `composeNarratedAd()`:

   Function signature:
   ```typescript
   async function composeNarratedAd(
     videoPath: string,
     narrationPath: string,
     musicPath: string,
     sfxDir: string,
     sentences: { videoStart: number, videoEnd: number }[],
     chunkDurations: number[], // ms per sentence from ElevenLabs
     audioAnalysis: { hasSpeech: boolean },
     outputPath: string
   ): Promise<void>
   ```

   Build the FFmpeg filter_complex string dynamically:
   - **Video**: For each sentence, `trim=start:end,setpts=PTS-STARTPTS`. The target segment duration is `chunkDurations[i]` ms (from ElevenLabs). If the Gemini clip `(videoEnd - videoStart)` is shorter than the narration duration, **hold the last frame** using `tpad=stop_mode=clone:stop_duration={gap}` to fill the time. If it's longer, trim to match. Never leave A/V gaps. Concat all segments. Scale to 1080x1920 with letterbox.
   - **Audio — voice**: Center mono (already mono from ElevenLabs, just format to stereo)
   - **Audio — music**: Apply `stereotools=mode=ms:slevel=1.5` for spatial width
   - **Audio — ducking**: `[music_wide][voice]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=1000`
   - **Audio — SFX**: For each cut point, `adelay` a whoosh. Alternate L/R pan. Volume at 50%.
   - **Audio — final mix**: `amix` all layers

   This is the hardest part. Build the filter chain incrementally:
   1. First get video trimming + concat working
   2. Then add voice + music (simple amix)
   3. Then swap amix for sidechaincompress
   4. Then add SFX
   5. Then add spatial (stereotools + pan)

   **Debug tip**: Build the FFmpeg command as a string array, log it, and test it manually in terminal first.

**Test**: Create a test with a sample video + narration audio + music file. Verify the output MP4 plays correctly.

### Hour 3 (2:00–3:00): FFmpeg Composition — Music-Only Ads

7. **`composeMusicAd()`** in `lib/ffmpeg.ts`:

   Function signature:
   ```typescript
   async function composeMusicAd(
     videoPath: string,
     musicPath: string,
     sfxDir: string,
     cuts: { videoStart: number, videoEnd: number, textOverlay?: string }[],
     audioAnalysis: { hasSpeech: boolean },
     outputPath: string
   ): Promise<void>
   ```

   - **Video**: Trim per beat-snapped cut list. Concat. Scale 1080x1920.
   - **Text overlays**: For cuts with `textOverlay`, add `drawtext` filter:
     - Font: white, size 72, centered. Add a semi-transparent black box behind text for readability.
     - `drawtext=text='Product Name':fontfile=/System/Library/Fonts/Helvetica.ttc:fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5:boxborderw=10`
     - **Must specify `fontfile`** — without it, `drawtext` silently fails or errors on servers with no default font. Use `/System/Library/Fonts/Helvetica.ttc` on macOS or `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` on Linux.
   - **Audio — music**: Full stereo, `stereotools mode=ms:slevel=1.8` (more aggressive than narrated since no voice)
   - **Audio — SFX**: Whooshes at each cut, hard L/R pans (full volume, harder pans than narrated)
   - **Audio — ambient**: If `!hasSpeech`, mix source video audio at 10% as ambient bed

**Test**: Test with beat-snapped cuts. Verify cuts land on expected timestamps.

### Hour 3–4 (3:00–4:00): API Route + Integration

8. **`app/api/compose-video/route.ts`** — POST handler:
   - `export const runtime = 'nodejs'`
   - `export const maxDuration = 120`
   - Parse FormData:
     - `video` — source video file
     - `narration` — narration audio (optional, narrated only)
     - `music` — music WAV from Lyria (returned by `/api/generate-music`)
     - `cutList` — JSON string with cuts/sentences
     - `chunkDurations` — JSON string with per-sentence durations in ms (narrated only)
     - `audioAnalysis` — JSON string (forwarded from analyze-video response)
     - `adType` — "narrated" | "music_only"
     - `bpm` — number (forwarded from analyze-video response)
     - *(no `sfxDir` — hardcode as `path.join(process.cwd(), 'public/sfx')` on the server)*
   - Write all files to `/tmp/adify-{timestamp}/`
   - Call `composeNarratedAd()` or `composeMusicAd()`
   - Read output file, return as Response with `Content-Type: video/mp4`
   - **Clean up `/tmp/adify-{timestamp}/` after reading the output** — each composition can be 100MB+

9. **Test end-to-end** with Person 2's actual outputs:
   - Get a real Gemini analysis → real ElevenLabs audio → real Lyria music
   - Feed into your compose functions
   - Verify the final video

10. **Debug and tune**:
    - Ducking ratio — is voice clearly audible over music?
    - SFX volume — audible but not jarring?
    - Spatial width — noticeable on headphones?
    - Text overlay readability — size, position, background box?
    - Cut precision — no black frames between segments?

---

## Timeline Overview

```
Hour    Person 1 (Frontend)      Person 2 (AI Pipeline)      Person 3 (Audio + FFmpeg)
─────   ─────────────────────    ────────────────────────    ─────────────────────────
0:00    Scaffold + landing       .env + Gemini setup         Install FFmpeg, source SFX
0:30    Shopify fetch + grid     Gemini narrated analysis    audio-analysis.ts + beats.ts
1:00    Product grid done        Gemini music-only analysis  Start composeNarratedAd
1:30    Generate page + upload   ElevenLabs TTS              Video trim + concat working
2:00    AdTypeSelector UI        Lyria music generation      Add ducking + SFX + spatial
2:30    GenerationView + wire    Parallelization + compress  composeNarratedAd done
3:00    Wire all API calls       Integration + edge cases    composeMusicAd + API route
3:30    "Make Another" + polish  Demo prep + backup assets   End-to-end + tuning
3:45    ──────────── ALL: Integration test + demo dry run ────────────
4:00    DONE
```

**The 3:45 mark is sacred.** Everyone stops feature work at 3:30 and spends the last 30 minutes on integration testing and demo prep. No new features after 3:30.

## Sync Points

| Time | What | Who |
|------|------|-----|
| **0:00** | Agree on API request/response shapes (see contracts at bottom of this doc) | All 3 |
| **1:00** | Person 2: share working Gemini output JSON. Person 1: product grid working. | P1 ↔ P2 |
| **2:00** | Person 2: share real audio files for Person 3 to test with. Person 1: generate page UI ready. | P2 → P3 |
| **3:00** | Person 3: compose-video API route ready. Person 1: wire real API calls. | P1 ↔ P3 |
| **3:30** | STOP feature work. Full integration test on one machine. | All 3 |
| **3:45** | Demo dry run. Pre-generate backup assets for 2-3 products. | All 3 |

## Critical Path

The bottleneck is **Person 3's FFmpeg filter chains**. If these are taking too long:
- Drop SFX first (least important)
- Drop spatial mix second (nice-to-have)
- Keep sidechain ducking (biggest audio impact, one filter)
- Worst case: flat `volume=0.15` on music, no SFX, no spatial — still a working demo

**Person 2's Gemini integration is the second risk.** If video upload is slow or unreliable:
- Pre-compress video before upload (scale to 640p)
- Have a hardcoded fallback script for 2-3 demo products
- Can test Person 3's FFmpeg pipeline with mock data while Gemini is being debugged

**Person 1 is unblocked the entire time** — they can build and test the full UI with mocked API responses.

---

## API Contracts (agree on these at 0:00)

### `POST /api/analyze-video`
**Request**: FormData
- `video`: File
- `product`: JSON string `{ title, description, price }`
- `adType`: `"narrated"` | `"music_only"`
- `duration`: `15` | `30` | `60`
- `storeUrl`: string (for analytics)
- `productHandle`: string (for analytics)
- `hasVideo`: `"true"` | `"false"` (string — FormData doesn't support booleans; for analytics)
- *(no `audioAnalysis` input — this route runs audio analysis internally)*

**Response** (narrated):
```json
{
  "mood": "energetic",
  "bpm": 128,
  "voice": { "elevenlabs_voice_id": "JBFqnCBsd6RMkjVDRZzb" },
  "sentences": [
    { "text": "...", "videoStart": 0.0, "videoEnd": 4.2 },
    { "text": "...", "videoStart": 12.5, "videoEnd": 18.1 }
  ],
  "audioAnalysis": { "silenceRegions": [], "meanVolume": -22, "hasSpeech": false }
}
```

**Response** (music_only):
```json
{
  "mood": "luxury",
  "bpm": 72,
  "cuts": [
    { "videoStart": 0.0, "videoEnd": 3.5, "textOverlay": null },
    { "videoStart": 8.2, "videoEnd": 12.0, "textOverlay": "Product Name" }
  ],
  "audioAnalysis": { "silenceRegions": [], "meanVolume": -22, "hasSpeech": false }
}
```

### `POST /api/generate-music`
**Request**: JSON
```json
{ "mood": "energetic", "durationSeconds": 30 }
```

**Response**: `audio/wav` blob (stream directly, return as Response)

### `POST /api/generate-audio`
**Request**: JSON
```json
{ "sentences": ["sentence1", "sentence2"], "voiceId": "JBFqnCBsd6RMkjVDRZzb" }
```

**Response**: JSON
```json
{
  "chunks": [{ "durationMs": 2400 }, { "durationMs": 3100 }],
  "fullAudioBase64": "..."
}
```
*`durationMs` is measured with `ffprobe` on each chunk — not estimated from byte size.*

### `POST /api/compose-video`
**Request**: FormData
- `video`: File (source video)
- `narration`: File (optional — narrated only)
- `music`: File (WAV from `/api/generate-music`)
- `cutList`: JSON string (sentences or cuts array)
- `chunkDurations`: JSON string (narrated only — `[2400, 3100]` in ms)
- `audioAnalysis`: JSON string (forwarded from `/api/analyze-video` response)
- `adType`: `"narrated"` | `"music_only"`
- `bpm`: number (forwarded from `/api/analyze-video` response)
- *(no `sfxDir` — SFX paths are hardcoded on the server as `/public/sfx/`)*

**Response**: `video/mp4` blob
