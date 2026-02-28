import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'

const execFileAsync = promisify(execFile)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Sentence {
  clipIndex: number
  videoStart: number
  videoEnd: number
}

export interface Cut {
  clipIndex: number
  videoStart: number
  videoEnd: number
  textOverlay?: string | null
}

export interface AudioAnalysis {
  hasSpeech: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pick a font file that exists on the current OS. */
function systemFont(): string {
  switch (os.platform()) {
    case 'win32':
      return 'C:\\Windows\\Fonts\\arial.ttf'
    case 'darwin':
      return '/System/Library/Fonts/Helvetica.ttc'
    default:
      return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  }
}

/** Resolve the ffmpeg binary — uses FFMPEG_PATH env var if set, otherwise 'ffmpeg'. */
const FFMPEG_BIN = process.env.FFMPEG_PATH ?? 'ffmpeg'

/** Check if the drawtext filter is available (requires libfreetype). */
let _hasDrawtext: boolean | null = null
async function hasDrawtext(): Promise<boolean> {
  if (_hasDrawtext !== null) return _hasDrawtext
  try {
    const { stdout } = await execFileAsync(FFMPEG_BIN, ['-filters'])
    _hasDrawtext = stdout.includes('drawtext')
  } catch {
    _hasDrawtext = false
  }
  return _hasDrawtext
}

/** Run ffmpeg with the given args, logging the full command on failure. */
async function runFFmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync(FFMPEG_BIN, args, { maxBuffer: 100 * 1024 * 1024 })
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string }
    console.error('FFmpeg failed.\nCommand:', [FFMPEG_BIN, ...args].join(' '))
    console.error('Stderr:', e.stderr ?? e.message)
    throw new Error(`FFmpeg error: ${e.stderr ?? e.message}`)
  }
}

// ─── Narrated Ad ──────────────────────────────────────────────────────────────

/**
 * Compose a narrated ad. Trims source video segments to match per-sentence
 * ElevenLabs narration durations, then layers voice + sidechain-ducked music
 * + spatial SFX into the final 1080x1920 MP4.
 */
export async function composeNarratedAd(
  videoPaths: string[],
  narrationPath: string,
  musicPath: string,
  sfxDir: string,
  sentences: Sentence[],
  chunkDurations: number[], // ms per sentence, measured by ffprobe
  audioAnalysis: AudioAnalysis,
  outputPath: string
): Promise<void> {
  const n = sentences.length
  if (n === 0) throw new Error('composeNarratedAd: no sentences provided')

  const cutCount = n - 1

  const inputs: string[] = []
  for (const vp of videoPaths) {
    inputs.push('-i', vp)
  }
  const narrationIdx = videoPaths.length
  const musicIdx = videoPaths.length + 1
  inputs.push('-i', narrationPath)
  inputs.push('-i', musicPath)
  for (let i = 0; i < cutCount; i++) {
    inputs.push('-i', path.join(sfxDir, `whoosh-${(i % 3) + 1}.mp3`))
  }

  const f: string[] = []

  // ── VIDEO ──────────────────────────────────────────────────────────────────

  for (let i = 0; i < n; i++) {
    const { clipIndex, videoStart, videoEnd } = sentences[i]
    const targetDur = chunkDurations[i] / 1000
    const clipDur   = videoEnd - videoStart
    const trimDur   = Math.min(clipDur, targetDur)
    const padDur    = Math.max(0, targetDur - clipDur)

    const padFilter = padDur > 0.01
      ? `,tpad=stop_mode=clone:stop_duration=${padDur.toFixed(3)}`
      : ''

    f.push(
      `[${clipIndex}:v]trim=start=${videoStart.toFixed(3)}:duration=${trimDur.toFixed(3)},` +
      `setpts=PTS-STARTPTS${padFilter}[seg${i}]`
    )
  }

  f.push(`${range(n).map(i => `[seg${i}]`).join('')}concat=n=${n}:v=1:a=0[vc]`)
  f.push(
    `[vc]scale=1920:1080:force_original_aspect_ratio=decrease,` +
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black[v]`
  )

  // ── AUDIO ──────────────────────────────────────────────────────────────────

  f.push(`[${narrationIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,asplit=2[voice][voice_sc]`)
  f.push(
    `[${musicIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
    `stereotools=slev=1.5[music_wide]`
  )
  f.push(
    `[music_wide][voice_sc]sidechaincompress=` +
    `threshold=0.02:ratio=6:attack=200:release=1000[ducked]`
  )

  const sfxLabels: string[] = []
  let cumulativeMs = 0

  for (let i = 0; i < cutCount; i++) {
    cumulativeMs += chunkDurations[i]
    const delayMs  = Math.max(0, cumulativeMs - 100)
    const sfxInput = videoPaths.length + 2 + i
    const sfxLabel = `sfx${i}`
    const pan = i % 2 === 0
      ? 'pan=stereo|c0=1.5*c0|c1=0.3*c0'
      : 'pan=stereo|c0=0.3*c0|c1=1.5*c0'

    f.push(`[${sfxInput}:a]adelay=${delayMs}|${delayMs},${pan},volume=0.5[${sfxLabel}]`)
    sfxLabels.push(`[${sfxLabel}]`)
  }

  const mixStreams = ['[voice]', '[ducked]', ...sfxLabels]
  f.push(
    `${mixStreams.join('')}amix=inputs=${mixStreams.length}:duration=first:normalize=0[a]`
  )

  await runFFmpeg([
    ...inputs,
    '-filter_complex', f.join(';\n'),
    '-map', '[v]',
    '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    '-y', outputPath,
  ])
}

// ─── Music-Only Ad ────────────────────────────────────────────────────────────

/**
 * Compose a music-only ad from beat-snapped cuts.
 * Burns in text overlays where specified, full-width spatial music, hard-panned SFX.
 */
export async function composeMusicAd(
  videoPaths: string[],
  musicPath: string,
  sfxDir: string,
  cuts: Cut[],
  audioAnalysis: AudioAnalysis,
  outputPath: string
): Promise<void> {
  const n = cuts.length
  if (n === 0) throw new Error('composeMusicAd: no cuts provided')

  const cutCount = n - 1
  const font = systemFont()

  const inputs: string[] = []
  for (const vp of videoPaths) {
    inputs.push('-i', vp)
  }
  const musicIdx = videoPaths.length
  inputs.push('-i', musicPath)
  for (let i = 0; i < cutCount; i++) {
    inputs.push('-i', path.join(sfxDir, `whoosh-${(i % 3) + 1}.mp3`))
  }

  const f: string[] = []
  const canDrawText = await hasDrawtext()

  // ── VIDEO ──────────────────────────────────────────────────────────────────

  for (let i = 0; i < n; i++) {
    const { clipIndex, videoStart, videoEnd, textOverlay } = cuts[i]
    const dur = (videoEnd - videoStart).toFixed(3)

    let chain =
      `[${clipIndex}:v]trim=start=${videoStart.toFixed(3)}:duration=${dur},setpts=PTS-STARTPTS`

    if (textOverlay && canDrawText) {
      const safe = textOverlay.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')
      chain +=
        `,drawtext=text='${safe}'` +
        `:fontfile='${font.replace(/\\/g, '/').replace(/:/g, '\\:')}'` +
        `:fontsize=72:fontcolor=white` +
        `:x=(w-text_w)/2:y=(h-text_h)/2` +
        `:box=1:boxcolor=black@0.5:boxborderw=10`
    }

    f.push(`${chain}[seg${i}]`)
  }

  f.push(`${range(n).map(i => `[seg${i}]`).join('')}concat=n=${n}:v=1:a=0[vc]`)
  f.push(
    `[vc]scale=1920:1080:force_original_aspect_ratio=decrease,` +
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black[v]`
  )

  // ── AUDIO ──────────────────────────────────────────────────────────────────

  f.push(
    `[${musicIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
    `stereotools=slev=1.8[music_wide]`
  )

  const sfxLabels: string[] = []
  let cumulativeSecs = 0

  for (let i = 0; i < cutCount; i++) {
    cumulativeSecs += cuts[i].videoEnd - cuts[i].videoStart
    const delayMs  = Math.max(0, Math.round(cumulativeSecs * 1000) - 100)
    const sfxInput = videoPaths.length + 1 + i
    const sfxLabel = `sfx${i}`
    const pan = i % 2 === 0
      ? 'pan=stereo|c0=2*c0'
      : 'pan=stereo|c1=2*c0'

    f.push(`[${sfxInput}:a]adelay=${delayMs}|${delayMs},${pan}[${sfxLabel}]`)
    sfxLabels.push(`[${sfxLabel}]`)
  }

  const mixStreams = ['[music_wide]', ...sfxLabels]
  f.push(
    `${mixStreams.join('')}amix=inputs=${mixStreams.length}:duration=first:normalize=0[a]`
  )

  await runFFmpeg([
    ...inputs,
    '-filter_complex', f.join(';\n'),
    '-map', '[v]',
    '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    '-y', outputPath,
  ])
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}
